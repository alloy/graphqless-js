import * as t from "@babel/types"
import template from "@babel/template"
import * as g from "graphql"
import invariant from "invariant"
import { parse as parseJS } from "@babel/parser"

export type CompiledQueryFunction = (
  schema: g.GraphQLSchema,
  rootValue: any
) => g.ExecutionResult

function parse(source: string): g.DocumentNode {
  return g.parse(source)
}

const operationFunctionBuilder = template.expression(`
  function %%operationName%%(schema, rootValue) {
    return {
      data: %%selectionSet%%
    };
  }
`)

const invokeDefaultFieldResolverBuilder = template.expression(`
  %%source%%[%%fieldName%%]
`)

const invokeFieldResolverBuilder = template.expression(`
  schema.getType(%%typeName%%).toConfig().fields.%%fieldName%%.resolve(%%source%%, %%args%%, undefined, %%resolveInfo%%)
`)

const objectTypeFieldResolverBuilder = template.expression(`
  function () {
    const %%source%% = %%invokeObjectFieldResolver%%;
    if (%%source%%) {
      return Object.assign(
        {},
        %%source%%,
        %%selectionSet%%,
      );
    }
  }
`)

function compileScalarTypeResolver({
  typeInfo,
  fieldNode,
  argumentProperties,
  source,
  emitAST,
}: {
  typeInfo: g.TypeInfo
  fieldNode: g.FieldNode
  argumentProperties: t.ObjectProperty[]
  source: t.Identifier
  emitAST: boolean
}): [t.Expression, boolean] {
  const parentType = typeInfo.getParentType()
  invariant(
    g.isObjectType(parentType),
    "Expected parentType to be an object type"
  )
  let expression: t.Expression
  let hasAsyncResolver: boolean = false
  const fieldConfig = parentType.toConfig().fields[fieldNode.name.value]
  if (fieldConfig.resolve) {
    // Generate AST for JSON representation of GraphQL AST
    // TODO: Merge multiple field selections
    let fieldNodes: t.ExpressionStatement | null = null
    if (emitAST) {
      fieldNodes = parseJS(JSON.stringify([fieldNode])).program
        .body[0] as t.ExpressionStatement
    }

    expression = invokeFieldResolverBuilder({
      source,
      args: t.objectExpression(argumentProperties),
      typeName: t.stringLiteral(parentType.name),
      fieldName: t.identifier(fieldNode.name.value),
      resolveInfo: t.objectExpression(
        fieldNodes === null
          ? []
          : [
              t.objectProperty(
                t.identifier("fieldNodes"),
                fieldNodes.expression
              ),
            ]
      ),
    })

    // TODO Optionally handle Promise return results when not an AsyncFunction
    const resolver = typeInfo.getFieldDef().resolve
    if (resolver && resolver.constructor.name === "AsyncFunction") {
      hasAsyncResolver = true
      expression = t.awaitExpression(expression)
    }
  } else {
    expression = invokeDefaultFieldResolverBuilder({
      source,
      fieldName: t.stringLiteral(fieldNode.name.value),
    })
  }
  return [expression, hasAsyncResolver]
}

function compileObjectTypeResolver({
  typeInfo,
  fieldNode,
  argumentProperties,
  source,
  parentSource,
  selectionSet,
  markAsync,
}: {
  typeInfo: g.TypeInfo
  fieldNode: g.FieldNode
  argumentProperties: t.ObjectProperty[]
  source: t.Identifier
  parentSource: t.Identifier
  selectionSet: t.ObjectExpression
  markAsync: boolean
}): t.Expression {
  const parentType = typeInfo.getParentType()
  invariant(
    g.isObjectType(parentType),
    "Expected parentType to be an object type"
  )
  // invariant(g.isObjectType(type), "Expected a object type");
  let invokeObjectFieldResolver: t.Expression
  invariant(
    g.isObjectType(parentType),
    "Expected parentType to be an object type"
  )
  const fieldConfig = parentType.toConfig().fields[fieldNode.name.value]
  if (fieldConfig.resolve) {
    invokeObjectFieldResolver = invokeFieldResolverBuilder({
      source: parentSource,
      args: t.objectExpression(argumentProperties),
      typeName: t.stringLiteral(parentType.name),
      fieldName: t.identifier(fieldNode.name.value),
      resolveInfo: undefined,
    })
  } else {
    invokeObjectFieldResolver = invokeDefaultFieldResolverBuilder({
      source: parentSource,
      fieldName: t.stringLiteral(fieldNode.name.value),
    })
  }

  let expression: t.Expression
  // Create resolver function
  expression = objectTypeFieldResolverBuilder({
    source,
    invokeObjectFieldResolver,
    selectionSet,
  })
  if (markAsync) {
    // Mark it async, if necessary
    expression = {
      ...(expression as t.FunctionExpression),
      async: true,
    }
  }
  // Invoke
  expression = t.callExpression(expression, [])
  if (markAsync) {
    // Await it, if it was async
    expression = t.awaitExpression(expression)
  }

  return expression
}

function transformOperations(
  source: g.DocumentNode,
  schema: g.GraphQLSchema,
  emitAST: boolean
): t.FunctionExpression[] {
  const operationFunctions: t.FunctionExpression[] = []

  const typeInfo = new g.TypeInfo(schema)

  const sourceStack: t.Identifier[] = []
  const selectionSetStack: t.ObjectProperty[][] = []
  let currentSelectionSet: t.ObjectExpression | null = null
  let markFunctionAsyncStack: boolean[] = []
  const markAncestorFunctionsAsync = () => {
    // Mark all entries in the stack as needing to be async,
    // newly added functions to the stack will remain sync by default
    markFunctionAsyncStack = markFunctionAsyncStack.map(() => true)
  }

  g.visit(
    source,
    g.visitWithTypeInfo(typeInfo, {
      OperationDefinition: {
        enter(operationNode) {
          invariant(
            operationNode.operation === "query",
            "Currently only query operations are supported"
          )
          sourceStack.push(t.identifier("rootValue"))
          markFunctionAsyncStack.push(false)
        },
        leave(operationNode) {
          invariant(
            selectionSetStack.length === 0,
            "Expected selectionSetStack to be empty by end of operation"
          )
          invariant(
            currentSelectionSet,
            "Expected there to be a current selection for root object type"
          )
          // TODO: Make this a graphql-js validation
          invariant(
            operationNode.name,
            "Expected operation to have a name to be used as name of the compiled function"
          )
          invariant(
            sourceStack.length === 1,
            "Expected sourceStack to be empty by end of operation"
          )
          sourceStack.pop()
          const markQueryFunctionAsync = markFunctionAsyncStack.pop()!
          operationFunctions.push({
            ...(operationFunctionBuilder({
              operationName: operationNode.name.value,
              selectionSet: currentSelectionSet,
            }) as t.FunctionExpression),
            async: markQueryFunctionAsync,
          })
          currentSelectionSet = null
        },
      },
      Argument(argNode) {
        return false
      },
      Field: {
        enter(fieldNode) {
          const type = typeInfo.getType()
          invariant(type, "Expected field to have a type")
          // TODO: Check what this _is_ instead of what it isn't
          if (!g.isScalarType(type)) {
            markFunctionAsyncStack.push(false)
            sourceStack.push(t.identifier(`result_${sourceStack.length}`))
          }
        },
        leave(fieldNode) {
          let expression: t.Expression

          const type = typeInfo.getType()
          invariant(type, "Expected field to have a type")
          const parentType = typeInfo.getParentType()
          invariant(parentType, "Expected field to have a parent type")
          const source = sourceStack[sourceStack.length - 1]
          invariant(source, "Expected a source identifier on the stack")

          const argumentProperties: t.ObjectProperty[] = compileArguments(
            fieldNode
          )

          if (g.isScalarType(type)) {
            const [
              resolverExpression,
              hasAsyncResolver,
            ] = compileScalarTypeResolver({
              typeInfo,
              fieldNode,
              argumentProperties,
              source,
              emitAST,
            })
            expression = resolverExpression
            if (hasAsyncResolver) {
              markAncestorFunctionsAsync()
            }
          } else {
            sourceStack.pop()
            const parentSource = sourceStack[sourceStack.length - 1]
            invariant(
              currentSelectionSet,
              "Expected there to be a current selection for object type"
            )
            const selectionSet = currentSelectionSet
            currentSelectionSet = null
            const markAsync = !!markFunctionAsyncStack.pop()
            expression = compileObjectTypeResolver({
              typeInfo,
              fieldNode,
              argumentProperties,
              source,
              parentSource,
              selectionSet,
              markAsync,
            })
          }
          selectionSetStack[selectionSetStack.length - 1].push(
            t.objectProperty(t.identifier(fieldNode.name.value), expression)
          )
        },
      },
      SelectionSet: {
        enter() {
          selectionSetStack.push([])
        },
        leave() {
          const properties = selectionSetStack.pop()
          invariant(properties, "Expected object properties")
          currentSelectionSet = t.objectExpression(properties)
        },
      },
    })
  )

  return operationFunctions
}

function compileArguments(fieldNode: g.FieldNode) {
  const argumentProperties: t.ObjectProperty[] = []
  if (fieldNode.arguments) {
    fieldNode.arguments.forEach((arg) => {
      let valueExpression: t.Expression
      switch (arg.value.kind) {
        case "StringValue":
        case "EnumValue":
          valueExpression = t.stringLiteral(arg.value.value)
          break
        case "IntValue":
          valueExpression = t.numericLiteral(parseInt(arg.value.value, 10))
          break
        case "FloatValue":
          valueExpression = t.numericLiteral(parseFloat(arg.value.value))
          break
        case "BooleanValue":
          valueExpression = t.booleanLiteral(arg.value.value)
          break
        case "NullValue":
          valueExpression = t.nullLiteral()
          break
        case "Variable":
        case "ListValue":
        case "ObjectValue":
        default:
          throw new Error(`TODO: Unsupported arg type ${arg.value.kind}`)
      }
      argumentProperties.push(
        t.objectProperty(t.identifier(arg.name.value), valueExpression)
      )
    })
  }
  return argumentProperties
}

export function compile(
  source: string,
  schema: g.GraphQLSchema,
  options?: { emitAST?: boolean }
): t.Node {
  const emitAST =
    options && options.emitAST !== undefined ? options.emitAST : true
  const functionExpressions = transformOperations(
    parse(source),
    schema,
    emitAST
  )
  const body = functionExpressions.map((fn) => t.expressionStatement(fn))
  return t.program(body)
}

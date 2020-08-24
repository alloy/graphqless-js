import * as t from "@babel/types";
import template from "@babel/template";
import * as g from "graphql";
import invariant from "invariant";
import { parse as parseJS } from "@babel/parser";

export type CompiledQueryFunction = (
  schema: g.GraphQLSchema,
  rootValue: any
) => g.ExecutionResult;

function parse(source: string): g.DocumentNode {
  return g.parse(source);
}

const operationFunctionBuilder = template.expression(`
  function %%operationName%%(schema, rootValue) {
    return {
      data: %%selectionSet%%
    };
  }
`);

const invokeDefaultFieldResolverBuilder = template.expression(`
  %%source%%[%%fieldName%%]
`);

const invokeFieldResolverBuilder = template.expression(`
  schema.getType(%%typeName%%).toConfig().fields.%%fieldName%%.resolve(%%source%%, %%args%%, undefined, %%resolveInfo%%)
`);

const invokeObjectTypeFieldResolverBuilder = template.expression(`
  function () {
    const %%source%% = %%invokeObjectFieldResolver%%;
    if (%%source%%) {
      return Object.assign(
        {},
        %%source%%,
        %%selectionSet%%,
      );
    }
  }()
`);

function transformOperations(
  source: g.DocumentNode,
  schema: g.GraphQLSchema,
  emitAST: boolean
): t.FunctionExpression[] {
  const operationFunctions: t.FunctionExpression[] = [];

  const typeInfo = new g.TypeInfo(schema);

  const sourceStack: t.Identifier[] = [];
  const selectionSetStack: t.ObjectProperty[][] = [];
  let currentSelectionSet: t.ObjectExpression | null = null;

  g.visit(
    source,
    g.visitWithTypeInfo(typeInfo, {
      OperationDefinition: {
        enter(operationNode) {
          invariant(
            operationNode.operation === "query",
            "Currently only query operations are supported"
          );
          sourceStack.push(t.identifier("rootValue"));
        },
        leave(operationNode) {
          invariant(
            selectionSetStack.length === 0,
            "Expected selectionSetStack to be empty by end of operation"
          );
          invariant(
            currentSelectionSet,
            "Expected there to be a current selection for root object type"
          );
          // TODO: Make this a graphql-js validation
          invariant(
            operationNode.name,
            "Expected operation to have a name to be used as name of the compiled function"
          );
          invariant(
            sourceStack.length === 1,
            "Expected sourceStack to be empty by end of operation"
          );
          const source = sourceStack.pop()!;
          operationFunctions.push(
            operationFunctionBuilder({
              operationName: operationNode.name.value,
              selectionSet: currentSelectionSet,
            }) as t.FunctionExpression
          );
          currentSelectionSet = null;
        },
      },
      Argument(argNode) {
        return false;
      },
      Field: {
        enter(fieldNode) {
          const type = typeInfo.getType();
          invariant(type, "Expected field to have a type");
          // TODO: Check what this _is_ instead of what it isn't
          if (!g.isScalarType(type)) {
            sourceStack.push(t.identifier(`result_${sourceStack.length}`));
          }
        },
        leave(fieldNode) {
          let expression: t.Expression;

          const type = typeInfo.getType();
          invariant(type, "Expected field to have a type");
          const parentType = typeInfo.getParentType();
          invariant(parentType, "Expected field to have a parent type");
          const source = sourceStack[sourceStack.length - 1];
          invariant(source, "Expected a source identifier on the stack");

          const argumentProperties: t.ObjectProperty[] = [];
          if (fieldNode.arguments) {
            fieldNode.arguments.forEach((arg) => {
              let valueExpression: t.Expression;
              switch (arg.value.kind) {
                case "StringValue":
                case "EnumValue":
                  valueExpression = t.stringLiteral(arg.value.value);
                  break;
                case "IntValue":
                  valueExpression = t.numericLiteral(
                    parseInt(arg.value.value, 10)
                  );
                  break;
                case "FloatValue":
                  valueExpression = t.numericLiteral(
                    parseFloat(arg.value.value)
                  );
                  break;
                case "BooleanValue":
                  valueExpression = t.booleanLiteral(arg.value.value);
                  break;
                case "NullValue":
                  valueExpression = t.nullLiteral();
                  break;
                case "Variable":
                case "ListValue":
                case "ObjectValue":
                default:
                  throw new Error(
                    `TODO: Unsupported arg type ${arg.value.kind}`
                  );
              }
              argumentProperties.push(
                t.objectProperty(t.identifier(arg.name.value), valueExpression)
              );
            });
          }

          if (g.isScalarType(type)) {
            invariant(
              g.isObjectType(parentType),
              "Expected parentType to be an object type"
            );
            const fieldConfig = parentType.toConfig().fields[
              fieldNode.name.value
            ];
            if (fieldConfig.resolve) {
              // Generate AST for JSON representation of GraphQL AST
              // TODO: Merge multiple field selections
              let fieldNodes: t.ExpressionStatement | null = null;
              if (emitAST) {
                fieldNodes = parseJS(JSON.stringify([fieldNode])).program
                  .body[0] as t.ExpressionStatement;
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
              });
            } else {
              expression = invokeDefaultFieldResolverBuilder({
                source,
                fieldName: t.stringLiteral(fieldNode.name.value),
              });
            }
          } else {
            invariant(g.isObjectType(type), "Expected a object type");
            invariant(
              currentSelectionSet,
              "Expected there to be a current selection for object type"
            );
            sourceStack.pop();
            let invokeObjectFieldResolver: t.Expression;
            invariant(
              g.isObjectType(parentType),
              "Expected parentType to be an object type"
            );
            const fieldConfig = parentType.toConfig().fields[
              fieldNode.name.value
            ];
            if (fieldConfig.resolve) {
              invokeObjectFieldResolver = invokeFieldResolverBuilder({
                source: sourceStack[sourceStack.length - 1],
                args: t.objectExpression(argumentProperties),
                typeName: t.stringLiteral(parentType.name),
                fieldName: t.identifier(fieldNode.name.value),
                resolveInfo: undefined,
              });
            } else {
              invokeObjectFieldResolver = invokeDefaultFieldResolverBuilder({
                source: sourceStack[sourceStack.length - 1],
                fieldName: t.stringLiteral(fieldNode.name.value),
              });
            }
            expression = invokeObjectTypeFieldResolverBuilder({
              source,
              invokeObjectFieldResolver,
              selectionSet: currentSelectionSet,
            });
            currentSelectionSet = null;
          }
          selectionSetStack[selectionSetStack.length - 1].push(
            t.objectProperty(t.identifier(fieldNode.name.value), expression)
          );
        },
      },
      SelectionSet: {
        enter() {
          selectionSetStack.push([]);
        },
        leave() {
          const properties = selectionSetStack.pop();
          invariant(properties, "Expected object properties");
          currentSelectionSet = t.objectExpression(properties);
        },
      },
    })
  );

  return operationFunctions;
}

export function compile(
  source: string,
  schema: g.GraphQLSchema,
  options?: { emitAST?: boolean }
): t.Node {
  const emitAST =
    options && options.emitAST !== undefined ? options.emitAST : true;
  const functionExpressions = transformOperations(
    parse(source),
    schema,
    emitAST
  );
  const body = functionExpressions.map((fn) => t.expressionStatement(fn));
  return t.program(body);
}

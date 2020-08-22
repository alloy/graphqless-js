import * as t from "@babel/types";
import template from "@babel/template";
import * as g from "graphql";
import invariant from "invariant";

function parse(source: string): g.DocumentNode {
  return g.parse(source);
}

const invokeDefaultFieldResolverBuilder = template.expression(`
  %%source%%[%%fieldName%%]
`);

const invokeFieldResolverBuilder = template.expression(`
  schema.getType(%%typeName%%).toConfig().fields.%%fieldName%%.resolve(%%source%%)
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
  schema: g.GraphQLSchema
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
          operationFunctions.push(
            t.functionExpression(
              t.identifier(operationNode.name.value),
              [t.identifier("schema"), t.identifier("rootValue")],
              t.blockStatement([
                t.returnStatement(
                  t.objectExpression([
                    t.objectProperty(t.identifier("data"), currentSelectionSet),
                  ])
                ),
              ])
            )
          );
          currentSelectionSet = null;
        },
      },
      Field: {
        enter(fieldNode) {
          const type = typeInfo.getType();
          invariant(type, "Expected field to have a type");
          // TODO: Check what this _is_ instead
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

          if (g.isScalarType(type)) {
            invariant(
              g.isObjectType(parentType),
              "Expected parentType to be an object type"
            );
            const fieldConfig = parentType.toConfig().fields[
              fieldNode.name.value
            ];
            if (fieldConfig.resolve) {
              expression = invokeFieldResolverBuilder({
                source,
                typeName: t.stringLiteral(parentType.name),
                fieldName: t.identifier(fieldNode.name.value),
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
            expression = invokeObjectTypeFieldResolverBuilder({
              source,
              invokeObjectFieldResolver: invokeFieldResolverBuilder({
                source: sourceStack[sourceStack.length - 1],
                typeName: t.stringLiteral(parentType.name),
                fieldName: t.identifier(fieldNode.name.value),
              }),
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

export function compile(source: string, schema: g.GraphQLSchema): t.Node {
  const functionExpressions = transformOperations(parse(source), schema);
  const body = functionExpressions.map((fn) => t.expressionStatement(fn));
  return t.program(body);
}

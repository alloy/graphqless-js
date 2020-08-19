import * as t from "@babel/types";
import * as g from "graphql";

function parse(source: string): g.DocumentNode {
  return g.parse(source);
}

function transformFieldSelection(
  field: g.FieldNode,
  parentType: g.GraphQLCompositeType
): t.CallExpression {
  return t.callExpression(
    t.memberExpression(
      t.memberExpression(
        t.memberExpression(
          t.callExpression(
            t.memberExpression(
              t.callExpression(
                t.memberExpression(
                  t.identifier("schema"),
                  t.identifier("getType")
                ),
                [t.stringLiteral(parentType.name)]
              ),
              t.identifier("toConfig")
            ),
            []
          ),
          t.identifier("fields")
        ),
        t.identifier(field.name.value)
      ),
      t.identifier("resolve")
    ),
    []
  );
}

/**
 * TODO:
 * - validate operation name
 */
function transformOperation(
  operation: g.OperationDefinitionNode,
  schema: g.GraphQLSchema
): t.FunctionExpression {
  const fieldSelections: Array<{
    node: g.FieldNode;
    parentType: g.GraphQLCompositeType;
  }> = [];
  const typeInfo = new g.TypeInfo(schema);
  g.visit(
    operation,
    g.visitWithTypeInfo(typeInfo, {
      Field(node) {
        fieldSelections.push({ node, parentType: typeInfo.getParentType()! });
      },
    })
  );
  return t.functionExpression(
    t.identifier(operation.name!.value),
    [t.identifier("schema")],
    t.blockStatement([
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(
            t.identifier("data"),
            t.objectExpression(
              fieldSelections.map(({ node, parentType }) =>
                t.objectProperty(
                  t.identifier(node.name.value),
                  transformFieldSelection(node, parentType)
                )
              )
            )
          ),
        ])
      ),
    ])
  );
}

function transformOperations(
  source: g.DocumentNode,
  schema: g.GraphQLSchema
): t.FunctionExpression[] {
  const operationNodes: g.OperationDefinitionNode[] = [];
  g.visit(source, {
    OperationDefinition(node) {
      if (node.operation !== "query") {
        throw new Error("TODO: Currently only query operations are supported");
      }
      operationNodes.push(node);
      return false;
    },
  });
  return operationNodes.map((node) => transformOperation(node, schema));
}

export function compile(source: string, schema: g.GraphQLSchema): t.Node {
  const functionExpressions = transformOperations(parse(source), schema);
  const body = functionExpressions.map((fn) => t.expressionStatement(fn));
  return t.program(body);
}

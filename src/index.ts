import * as t from "@babel/types";
import * as g from "graphql";

function parse(source: string): g.DocumentNode {
  return g.parse(source);
}

function transformOperation(
  source: g.OperationDefinitionNode
): t.FunctionExpression {
  return t.functionExpression(
    t.identifier("SomeQuery"),
    [t.identifier("schema")],
    t.blockStatement([
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(
            t.identifier("data"),
            t.objectExpression([
              t.objectProperty(
                t.identifier("rootField"),
                t.callExpression(
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
                              [t.stringLiteral("Query")]
                            ),
                            t.identifier("toConfig")
                          ),
                          []
                        ),
                        t.identifier("fields")
                      ),
                      t.identifier("rootField")
                    ),
                    t.identifier("resolve")
                  ),
                  []
                )
              ),
            ])
          ),
        ])
      ),
    ])
  );
}

function transformOperations(source: g.DocumentNode): t.FunctionExpression[] {
  const functionExpressions: t.FunctionExpression[] = [];
  g.visit(source, {
    OperationDefinition(node) {
      const functionExpression = transformOperation(node);
      functionExpressions.push(functionExpression);
    },
  });
  return functionExpressions;
}

export function compile(source: string): t.Node {
  const functionExpressions = transformOperations(parse(source));
  const body = functionExpressions.map((fn) => t.expressionStatement(fn));
  return t.program(body);
}

import * as t from "@babel/types";

export function compile(source: string): t.Node {
  return t.program([
    t.expressionStatement(
      t.functionExpression(
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
      )
    ),
  ]);

  //   return `
  //   (function SomeQuery(schema) {
  //     return {
  //       data: {
  //         rootField: schema.getType("Query").toConfig().fields.rootField.resolve()
  //       }
  //     };
  //   })
  // `;
}

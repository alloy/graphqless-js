import { compile, CompiledQueryFunction } from "../index";

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  graphql,
  GraphQLFloat,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLResolveInfo,
} from "graphql";

import dedent from "dedent";
import generate from "@babel/generator";

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: () => ({
      aScalarRootField: {
        type: GraphQLString,
        resolve: (source, args, context, info) => {
          return "hello world";
        },
      },
      aScalarFieldWithoutResolver: {
        type: GraphQLString,
      },
      aFieldWithResolverThatTakesArguments: {
        type: GraphQLString,
        args: {
          stringArg: {
            type: GraphQLString,
          },
          intArg: {
            type: GraphQLInt,
          },
          floatArg: {
            type: GraphQLFloat,
          },
          booleanArg: {
            type: GraphQLBoolean,
          },
          nullArg: {
            type: GraphQLString,
          },
          enumArgWithValue: {
            type: new GraphQLEnumType({
              name: "EnumArgWithValueType",
              values: {
                ENUM_ENTRY_WITH_VALUE: {
                  value: "ENUM_ENTRY_WITH_VALUE",
                },
                ENUM_ENTRY_WITHOUT_VALUE: {},
              },
            }),
          },
          enumArgWithoutValue: {
            type: new GraphQLEnumType({
              name: "EnumArgWithoutValueType",
              values: {
                ENUM_ENTRY_WITHOUT_VALUE: {},
              },
            }),
          },
        },
        resolve: (source, args, context, info) => {
          return JSON.stringify({ source, args, context, info });
        },
      },
      anObjectRootField: {
        type: new GraphQLObjectType({
          name: "AnObjectRootFieldType",
          fields: () => ({
            aNestedScalarField: {
              type: GraphQLString,
              resolve: (source, args, context, info) => {
                return "hello world";
              },
            },
            aNestedObjectFieldWithoutResolver: {
              type: new GraphQLObjectType({
                name: "ANestedObjectFieldType",
                fields: () => ({
                  aScalarFieldWithoutResolver: {
                    type: GraphQLString,
                  },
                  anAsyncField: {
                    type: GraphQLString,
                    resolve: async (source) => source.anAsyncField,
                  },
                }),
              }),
            },
          }),
        }),
        resolve: (source, args, context, info) =>
          source ? source.anObjectRootField : {},
      },
    }),
  }),
});

function compileAndGenerate(source: string, emitAST?: boolean) {
  return generate(compile(source, schema, { emitAST: !!emitAST })).code;
}

function instantiateCompiledFunction(source: string) {
  return eval(source) as CompiledQueryFunction;
}

function compileQueryFunction(source: string, options?: { emitAST?: boolean }) {
  const src = compileAndGenerate(source, options && options.emitAST);
  return instantiateCompiledFunction(src);
}

async function graphQLExecutionResult(
  {
    source,
    rootValue,
  }: {
    source: string;
    rootValue?: object;
  },
  options?: { emitAST?: boolean }
) {
  const compiledFn = compileQueryFunction(source, options);
  const expected = await graphql({ schema, source, rootValue });
  const actual = await compiledFn(schema, rootValue);
  return { expected, actual };
}

async function expectToEqualGraphQLExecutionResult(
  source: string,
  rootValue?: object
) {
  const { expected, actual } = await graphQLExecutionResult({
    source,
    rootValue,
  });
  expect(expected).toEqual(actual);
}

/**
 * TODO:
 * - Test field without resolver and no provided data, should be null
 */
describe(compile, () => {
  describe("concerning resolver arguments", () => {
    it("receives source data from its parent field", async () => {
      const query = `
        query SomeQuery {
          aFieldWithResolverThatTakesArguments
        }
      `;
      const { actual } = await graphQLExecutionResult({
        source: query,
        rootValue: {
          someSource: "value",
        },
      });
      const { source } = JSON.parse(
        actual.data!.aFieldWithResolverThatTakesArguments
      );
      expect(source).toEqual({ someSource: "value" });
    });

    it("receives literal args", async () => {
      const query = `
        query SomeQuery {
          aFieldWithResolverThatTakesArguments(
            stringArg: "hello world",
            intArg: 42,
            floatArg: 0.42,
            booleanArg: true,
            nullArg: null,
            enumArgWithValue: ENUM_ENTRY_WITH_VALUE,
            enumArgWithoutValue: ENUM_ENTRY_WITHOUT_VALUE,
          )
        }
      `;

      expect(dedent(compileAndGenerate(query))).toEqual(dedent`
        (function SomeQuery(schema, rootValue) {
        return {
          data: {
            aFieldWithResolverThatTakesArguments: schema.getType("Query").toConfig().fields.aFieldWithResolverThatTakesArguments.resolve(rootValue, {
              stringArg: "hello world",
              intArg: 42,
              floatArg: 0.42,
              booleanArg: true,
              nullArg: null,
              enumArgWithValue: "ENUM_ENTRY_WITH_VALUE",
              enumArgWithoutValue: "ENUM_ENTRY_WITHOUT_VALUE"
            }, undefined, {})
          }
        };
        });
      `);

      const { actual } = await graphQLExecutionResult({ source: query });
      const { args } = JSON.parse(
        actual.data!.aFieldWithResolverThatTakesArguments
      );
      expect(args).toEqual({
        stringArg: "hello world",
        intArg: 42,
        floatArg: 0.42,
        booleanArg: true,
        nullArg: null,
        enumArgWithValue: "ENUM_ENTRY_WITH_VALUE",
        enumArgWithoutValue: "ENUM_ENTRY_WITHOUT_VALUE",
      });
    });

    it.todo("receives variable args");

    it("receives info AST", async () => {
      const query = `
        query SomeQuery {
          aFieldWithResolverThatTakesArguments(stringArg: "hello world")
        }
      `;
      const { actual, expected } = await graphQLExecutionResult(
        {
          source: query,
        },
        { emitAST: true }
      );
      const { info: actualInfo }: { info: GraphQLResolveInfo } = JSON.parse(
        actual.data!.aFieldWithResolverThatTakesArguments
      );
      const { info: expectedInfo }: { info: GraphQLResolveInfo } = JSON.parse(
        expected.data!.aFieldWithResolverThatTakesArguments
      );
      expect(actualInfo.fieldNodes).toEqual(expectedInfo.fieldNodes);
    });
  });

  describe("concerning scalar fields", () => {
    it("compiles a scalar field with resolver", async () => {
      const query = `
        query SomeQuery {
          aScalarRootField
        }
      `;

      expect(dedent(compileAndGenerate(query))).toEqual(dedent`
        (function SomeQuery(schema, rootValue) {
        return {
          data: {
            aScalarRootField: schema.getType("Query").toConfig().fields.aScalarRootField.resolve(rootValue, {}, undefined, {})
          }
        };
        });
      `);

      await expectToEqualGraphQLExecutionResult(query);
    });

    it("compiles a scalar field with default resolver", async () => {
      const query = `
        query SomeQuery {
          aScalarFieldWithoutResolver
        }
      `;

      expect(dedent(compileAndGenerate(query))).toEqual(dedent`
        (function SomeQuery(schema, rootValue) {
        return {
          data: {
            aScalarFieldWithoutResolver: rootValue["aScalarFieldWithoutResolver"]
          }
        };
        });
      `);

      await expectToEqualGraphQLExecutionResult(query, {
        aScalarFieldWithoutResolver: "hello worldd",
      });
    });
  });

  describe("concerning object fields", () => {
    it("compiles a object field with resolver", async () => {
      const query = `
        query SomeQuery {
          anObjectRootField {
            aNestedScalarField
          }
        }
      `;

      expect(dedent(compileAndGenerate(query))).toEqual(dedent`
        (function SomeQuery(schema, rootValue) {
        return {
          data: {
            anObjectRootField: function () {
              const result_1 = schema.getType("Query").toConfig().fields.anObjectRootField.resolve(rootValue, {}, undefined);
  
              if (result_1) {
                return Object.assign({}, result_1, {
                  aNestedScalarField: schema.getType("AnObjectRootFieldType").toConfig().fields.aNestedScalarField.resolve(result_1, {}, undefined, {})
                });
              }
            }()
          }
        };
        });
      `);

      await expectToEqualGraphQLExecutionResult(query);
    });

    it("marks the function as sync when no promise is returned", async () => {
      const compiledFn = compileQueryFunction(`
        query SomeQuery {
          anObjectRootField {
            aNestedObjectFieldWithoutResolver {
              aScalarFieldWithoutResolver
            }
          }
        }
      `);
      expect(compiledFn.constructor.name).toEqual("Function");
    });

    it("marks the function and parents as async when any promise is returned", async () => {
      const query = `
        query SomeQuery {
          anObjectRootField {
            aNestedObjectFieldWithoutResolver {
              anAsyncField
            }
          }
        }
      `;

      const compiledFn = compileAndGenerate(query);
      expect(dedent(compiledFn)).toEqual(dedent`
        (async function SomeQuery(schema, rootValue) {
        return {
          data: {
            anObjectRootField: await async function () {
              const result_1 = schema.getType("Query").toConfig().fields.anObjectRootField.resolve(rootValue, {}, undefined);
      
              if (result_1) {
                return Object.assign({}, result_1, {
                  aNestedObjectFieldWithoutResolver: await async function () {
                    const result_2 = result_1["aNestedObjectFieldWithoutResolver"];
      
                    if (result_2) {
                      return Object.assign({}, result_2, {
                        anAsyncField: await schema.getType("ANestedObjectFieldType").toConfig().fields.anAsyncField.resolve(result_2, {}, undefined, {})
                      });
                    }
                  }()
                });
              }
            }()
          }
        };
        });
      `);

      await expectToEqualGraphQLExecutionResult(query, {
        anObjectRootField: {
          aNestedObjectFieldWithoutResolver: {
            anAsyncField: Promise.resolve("hello world"),
          },
        },
      });
    });
  });

  it("compiles a object field with default resolver", async () => {
    const query = `
      query SomeQuery {
        anObjectRootField {
          aNestedObjectFieldWithoutResolver {
            aScalarFieldWithoutResolver
          }
        }
      }
    `;

    expect(dedent(compileAndGenerate(query))).toEqual(dedent`
      (function SomeQuery(schema, rootValue) {
      return {
        data: {
          anObjectRootField: function () {
            const result_1 = schema.getType("Query").toConfig().fields.anObjectRootField.resolve(rootValue, {}, undefined);

            if (result_1) {
              return Object.assign({}, result_1, {
                aNestedObjectFieldWithoutResolver: function () {
                  const result_2 = result_1["aNestedObjectFieldWithoutResolver"];

                  if (result_2) {
                    return Object.assign({}, result_2, {
                      aScalarFieldWithoutResolver: result_2["aScalarFieldWithoutResolver"]
                    });
                  }
                }()
              });
            }
          }()
        }
      };
      });
    `);

    await expectToEqualGraphQLExecutionResult(query, {
      anObjectRootField: {
        aNestedObjectFieldWithoutResolver: {
          aScalarFieldWithoutResolver: "hello world",
        },
      },
    });
  });
});

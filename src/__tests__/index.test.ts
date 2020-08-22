import { compile } from "../index";

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  graphql,
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
                }),
              }),
            },
          }),
        }),
        resolve: (source, args, context, info) => source.anObjectRootField,
      },
    }),
  }),
});

async function compileAndExecute(source: string, rootValue?: object) {
  const expected = await graphql({ schema, source, rootValue });
  const ast = compile(source, schema);
  const src = generate(ast).code;
  const compiledFn = eval(src);
  expect(compiledFn(schema, rootValue)).toEqual(expected);
  return src;
}

/**
 * TODO:
 * - Test field without resolver and no provided data, should be null
 */
describe(compile, () => {
  it("compiles root scalar fields", async () => {
    const src = await compileAndExecute(
      `
      query SomeQuery {
        aScalarRootField
        aScalarFieldWithoutResolver
      }
    `,
      { aScalarFieldWithoutResolver: "hello world" }
    );

    expect(dedent(src)).toEqual(dedent`
      (function SomeQuery(schema, rootValue) {
      return {
        data: {
          aScalarRootField: schema.getType("Query").toConfig().fields.aScalarRootField.resolve(rootValue),
          aScalarFieldWithoutResolver: rootValue["aScalarFieldWithoutResolver"]
        }
      };
      });
    `);
  });

  it("compiles nested fields", async () => {
    const src = await compileAndExecute(
      `
      query SomeQuery {
        anObjectRootField {
          aNestedScalarField
          aNestedObjectFieldWithoutResolver {
            aScalarFieldWithoutResolver
          }
        }
      }
    `,
      {
        anObjectRootField: {
          aNestedObjectFieldWithoutResolver: {
            aScalarFieldWithoutResolver: "hello world",
          },
        },
      }
    );

    expect(dedent(src)).toEqual(dedent`
      (function SomeQuery(schema, rootValue) {
      return {
        data: {
          anObjectRootField: function () {
            const result_1 = schema.getType("Query").toConfig().fields.anObjectRootField.resolve(rootValue);

            if (result_1) {
              return Object.assign({}, result_1, {
                aNestedScalarField: schema.getType("AnObjectRootFieldType").toConfig().fields.aNestedScalarField.resolve(result_1),
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
  });
});

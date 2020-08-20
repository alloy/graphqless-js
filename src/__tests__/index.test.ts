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
      anotherScalarRootField: {
        type: GraphQLString,
        resolve: (source, args, context, info) => {
          return "hello world";
        },
      },
    }),
  }),
});

async function compileAndExecute(source: string) {
  const expected = await graphql({ schema, source });
  const ast = compile(source, schema);
  const src = generate(ast).code;
  const compiledFn = eval(src);
  expect(compiledFn(schema)).toEqual(expected);
  return src;
}

describe(compile, () => {
  it("compiles", async () => {
    const src = await compileAndExecute(`
      query SomeQuery {
        aScalarRootField
        anotherScalarRootField
      }
    `);

    expect(dedent(src)).toEqual(dedent`
      (function SomeQuery(schema) {
      return {
        data: {
          aScalarRootField: schema.getType("Query").toConfig().fields.aScalarRootField.resolve(),
          anotherScalarRootField: schema.getType("Query").toConfig().fields.anotherScalarRootField.resolve()
        }
      };
      });
    `);
  });
});

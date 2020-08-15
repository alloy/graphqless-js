import { helloWorld } from "../index";

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  graphql,
} from "graphql";

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: () => ({
      rootField: {
        type: GraphQLString,
        resolve: (source, args, context, info) => {
          return "hello world";
        },
      },
    }),
  }),
});

describe(helloWorld, () => {
  it("works", async () => {
    const { data } = await graphql({
      schema,
      source: `
        {
          rootField
        }
      `,
    });

    expect(data!.rootField).toBe("hello world");
  });
});

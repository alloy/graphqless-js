# graphqless

Statically compiled resolvers for entire queries based on a graphql-js schema. That is, for a operation document and an
executable schema, the graphqless compiler will output JavaScript code that is able to execute that operation _without_
any GraphQL runtime execution such as parsing, validating, and figuring out what resolvers to invoke.

## Example

Turns this:

```graphql
query SomeQuery {
  anObjectRootField {
    aNestedScalarField
  }
}
```

…into this:

```js
(function SomeQuery(schema, rootValue) {
  return {
    data: {
      anObjectRootField: (function () {
        const result_1 = schema
          .getType("Query")
          .toConfig()
          .fields.anObjectRootField.resolve(rootValue, {}, undefined);

        if (result_1) {
          return Object.assign({}, result_1, {
            aNestedScalarField: schema
              .getType("AnObjectRootFieldType")
              .toConfig()
              .fields.aNestedScalarField.resolve(result_1, {}, undefined, {}),
          });
        }
      })(),
    },
  };
});
```

## Considerations

- Some field resolvers need the AST in order to execute. Always inlining all the AST for each field will presumably get expensive in terms of bundle size n(needs verification). Possible solutions:
  - Normalize ASTs for all combined queries so that sub-trees can be shared.
  - Only include AST for fields that were defined with a directive that instructs the compiler what AST will be needed. (E.g. also some of its sub-fields)
  - Statically inferring what fields might be needed is not trivial, but might be feasible with e.g. strict TS code.

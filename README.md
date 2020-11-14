# graphqless

Statically compiled resolvers for entire queries based on a graphql-js schema. That is, for a operation document and an
executable schema, the graphqless compiler will output JavaScript code that is able to execute that operation _without_
any GraphQL runtime execution overhead such as parsing, validating, and figuring out what resolvers to invoke.

:warning: This is currenntly a proof-of-concept implementation to research feasability and uncover considerations to
take into account. Any such considerations will be disucced in [the issue tracker](https://github.com/alloy/graphqless-js/issues?q=is%3Aissue+is%3Aopen+label%3Aconsiderations).

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
;(function SomeQuery(schema, rootValue) {
  return {
    data: {
      anObjectRootField: (function () {
        const result_1 = schema
          .getType("Query")
          .toConfig()
          .fields.anObjectRootField.resolve(rootValue, {}, undefined)

        if (result_1) {
          return Object.assign({}, result_1, {
            aNestedScalarField: schema
              .getType("AnObjectRootFieldType")
              .toConfig()
              .fields.aNestedScalarField.resolve(result_1, {}, undefined, {}),
          })
        }
      })(),
    },
  }
})
```

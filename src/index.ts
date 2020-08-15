export function compile(source: string): string {
  return `
  (function SomeQuery(schema) {
    return {
      data: {
        rootField: schema.getType("Query").toConfig().fields.rootField.resolve()
      }
    };
  })
`;
}

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { Kind } = require('graphql');
const { BooksDocument } = require('@transformlit/graphql');

test('package root exports an actual generated DocumentNode', () => {
  assert.equal(BooksDocument.kind, Kind.DOCUMENT);
  assert.equal(BooksDocument.definitions[0].name.value, 'Books');
});

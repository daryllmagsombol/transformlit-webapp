const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');

test('Turbo hashes SDL and operation inputs and caches GraphQL build outputs for web consumers', () => {
  const output = execFileSync(
    'pnpm',
    ['exec', 'turbo', 'run', 'build', 'typecheck', '--filter=@transformlit/web', '--dry=json'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const jsonStart = output.indexOf('{');
  const dryRun = JSON.parse(output.slice(jsonStart));
  const graphqlBuild = dryRun.tasks.find((task) => task.taskId === '@transformlit/graphql#build');
  const webBuild = dryRun.tasks.find((task) => task.taskId === '@transformlit/web#build');
  const webTypecheck = dryRun.tasks.find((task) => task.taskId === '@transformlit/web#typecheck');
  const schemaInput = Object.keys(graphqlBuild.inputs).find((input) => input.endsWith('apps/api/src/schema.gql'));

  assert.ok(schemaInput, 'GraphQL build hash includes canonical SDL');
  assert.ok(Object.keys(graphqlBuild.inputs).some((input) => input.endsWith('operations/books.graphql')));
  assert.ok(graphqlBuild.outputs.includes('dist/**'));
  assert.ok(graphqlBuild.outputs.includes('src/__generated__/**'));
  assert.ok(webBuild.dependencies.includes('@transformlit/graphql#build'));
  assert.ok(webTypecheck.dependencies.includes('@transformlit/graphql#build'));

  const packageTurbo = JSON.parse(readFileSync(path.join(repoRoot, 'packages/graphql/turbo.json'), 'utf8'));
  assert.deepEqual(packageTurbo.extends, ['//']);
  for (const taskName of ['build', 'typecheck']) {
    assert.ok(packageTurbo.tasks[taskName].inputs.includes('../../apps/api/src/schema.gql'));
    assert.ok(packageTurbo.tasks[taskName].inputs.includes('codegen.ts'));
    assert.ok(packageTurbo.tasks[taskName].inputs.includes('operations/**/*.graphql'));
  }
  assert.ok(packageTurbo.tasks.build.outputs.includes('dist/**'));
  assert.ok(packageTurbo.tasks.build.outputs.includes('src/__generated__/**'));
  assert.ok(packageTurbo.tasks.typecheck.outputs.includes('src/__generated__/**'));
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'packages/graphql/package.json'), 'utf8'));
  assert.match(packageJson.scripts.build, /graphql:codegen/);
  assert.match(packageJson.scripts.typecheck, /graphql:codegen/);
});

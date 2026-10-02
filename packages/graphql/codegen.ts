import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../../apps/api/src/schema.gql',
  documents: ['./operations/**/*.graphql'],
  generates: {
    './src/__generated__/': {
      preset: 'client',
      presetConfig: {
        gqlTagName: 'gql',
        fragmentMasking: false,
      },
      config: {
        enumsAsTypes: true,
        maybeValue: 'T | null',
      },
    },
  },
  ignoreNoDocuments: true,
};

export default config;

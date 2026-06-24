import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../api/src/schema.gql', // generated later by NestJS
  documents: ['./operations/**/*.graphql'],
  generates: {
    './__generated__/': {
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

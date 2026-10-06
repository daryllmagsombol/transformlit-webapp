import 'reflect-metadata';
import { Injectable } from '@nestjs/common';

// Non-empty so SonarQube S2094 does not flag it; the class must stay a runtime
// value for `emitDecoratorMetadata` to record it in `design:paramtypes`.
class ProbeDependency {
  readonly marker = 'probe-dependency';
}

@Injectable()
class ProbeService {
  constructor(readonly dependency: ProbeDependency) {}
}

const parameterTypes = Reflect.getMetadata('design:paramtypes', ProbeService) as unknown[] | undefined;
if (parameterTypes?.[0] !== ProbeDependency) {
  throw new Error('Compiled schema command runner did not emit Nest design:paramtypes metadata');
}
process.stdout.write('Schema command runner preserves design:paramtypes.\n');

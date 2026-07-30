import * as lib from './index';

describe('cdk-composition', () => {
  test('package exports resolve', () => {
    expect(lib.compose).toBeInstanceOf(Function);
    expect(lib.Composition).toBeInstanceOf(Function);
  });
});

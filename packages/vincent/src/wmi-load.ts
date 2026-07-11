export function loadExtendedModule(): Promise<typeof import('./wmi-extended.generated.js')> {
  return import('./wmi-extended.generated.js');
}

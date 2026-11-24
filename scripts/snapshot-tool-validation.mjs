import { writeFile } from 'node:fs/promises';

export async function writeToolSnapshot(spec, source) {
  const definitions = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = value.$ref.split('/').at(-1);
      if (!definitions[name]) {
        if (!spec.components.schemas[name]) throw new Error(`Missing definition: ${name}`);
        definitions[name] = spec.components.schemas[name];
        visit(definitions[name]);
      }
    }
    Object.values(value).forEach(visit);
  }

  const operations = {};
  for (const [name, path, method] of [
    ['create_tool', '/tool', 'post'],
    ['update_tool', '/tool/{id}', 'patch'],
  ]) {
    const contract = spec.paths[path][method].requestBody.content['application/json'].schema;
    operations[name] = Object.fromEntries(contract.oneOf.map(ref => {
      const dto = ref.$ref.split('/').at(-1);
      const type = spec.components.schemas[dto].properties.type.enum[0];
      visit(ref);
      return [type, dto];
    }));
  }
  const id = spec.paths['/tool/{id}'].patch.parameters.find(p => p.name === 'id' && p.in === 'path').schema;
  const output = new URL('../src/schemas/tool-openapi.json', import.meta.url);
  await writeFile(output, JSON.stringify({ source, operations, id, definitions }, null, 2) + '\n');
  console.log('Saved tool configuration input contracts');
}

// Model-facing excerpts only. Full records remain in PostgreSQL and the owner dashboard/export.
export function fitRecords<T>(records: T[], maxCharacters: number): T[] {
  const result: T[] = [];
  for (const record of records) {
    if (JSON.stringify([...result, record]).length > maxCharacters) break;
    result.push(record);
  }
  return result;
}
export function boundToolData(value: unknown) {
  let truncated = false;
  const walk = (v: any, depth = 0): any => {
    if (v instanceof Date) return v.toISOString();
    if (depth > 7) {
      truncated = true;
      return '[nested details omitted]';
    }
    if (typeof v === 'string' && v.length > 600) {
      truncated = true;
      return v.slice(0, 600) + ' [excerpt]';
    }
    if (Array.isArray(v)) {
      if (v.length > 20) truncated = true;
      return v.slice(0, 20).map((x) => walk(x, depth + 1));
    }
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, x] of Object.entries(v)) {
        if (['embedding', 'embedding_model', 'search_vector', 'canonical_hash'].includes(k)) {
          if (x) truncated = true;
          continue;
        }
        out[k] = walk(x, depth + 1);
      }
      return out;
    }
    return v;
  };
  let data = walk(value);
  if (JSON.stringify(data).length > 24000) {
    truncated = true;
    if (Array.isArray(data)) {
      data = fitRecords(data, 24000);
    } else {
      data = Object.fromEntries(
        [
          'id',
          'name',
          'title',
          'status',
          'risk',
          'scope_hash',
          'project_id',
          'conversation_id',
          'saved',
        ]
          .filter((k) => data[k] !== undefined)
          .map((k) => [k, data[k]]),
      );
      data.details_omitted = true;
    }
  }
  return { data, truncated_for_model: truncated };
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findByNormalizedName(map, name) {
  if (!map || !name) return null;
  if (map[name]) return map[name];

  const target = normalizeName(name);
  for (const key of Object.keys(map)) {
    const current = normalizeName(key);
    if (current === target || current.includes(target) || target.includes(current)) {
      return map[key];
    }
  }
  return null;
}

module.exports = { normalizeName, findByNormalizedName };

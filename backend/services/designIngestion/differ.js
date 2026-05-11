function normalizeValue(value) {
  return String(value || "").trim();
}

function diffWithDatabase(validRows, existingFixtures) {
  const diffResults = [];
  
  const fixtureMap = new Map();
  existingFixtures.forEach(f => fixtureMap.set(String(f.fixture_no).trim(), f));

  for (const incoming of validRows) {
    const existing = fixtureMap.get(incoming.fixture_no);
    
    if (!existing) {
      diffResults.push({ type: 'NEW', incoming });
      continue;
    }

    const isQtyDiff = existing.qty !== incoming.qty;
    const isPartDiff = normalizeValue(existing.part_name) !== normalizeValue(incoming.part_name);
    const incomingHasAnyImage = Boolean(incoming.image_1_url || incoming.image_2_url);
    const isOtherDiff = normalizeValue(existing.op_no) !== normalizeValue(incoming.op_no)
      || normalizeValue(existing.fixture_type) !== normalizeValue(incoming.fixture_type);
    const isImageDiff = incomingHasAnyImage
      && (
        normalizeValue(existing.image_1_url) !== normalizeValue(incoming.image_1_url)
        || normalizeValue(existing.image_2_url) !== normalizeValue(incoming.image_2_url)
      );

    if (!isQtyDiff && !isPartDiff && !isOtherDiff && !isImageDiff) {
      continue; // SKIP
    }

    if (isQtyDiff && !isPartDiff && !isOtherDiff && !isImageDiff) {
      diffResults.push({ type: 'UPDATE_QTY', incoming, existing });
      continue;
    }

    if (isPartDiff) {
      diffResults.push({ type: 'CONFLICT_PART_NAME', incoming, existing });
      continue;
    }

    if (isImageDiff) {
      diffResults.push({ type: 'CONFLICT_IMAGES', incoming, existing });
      continue;
    }

    diffResults.push({ type: 'CONFLICT_OTHER', incoming, existing });
  }

  return diffResults;
}

module.exports = {
  diffWithDatabase
};

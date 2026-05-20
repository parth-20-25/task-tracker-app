const { canonicalFixtureNo, normalizeComparableText } = require("./normalize");

function normalizeValue(value) {
  return String(value || "").trim();
}

function fixtureIdentityKey(fixtureNo) {
  return canonicalFixtureNo(fixtureNo);
}

function diffWithDatabase(validRows, existingFixtures) {
  const diffResults = [];

  const fixtureMap = new Map();
  existingFixtures.forEach((f) => {
    fixtureMap.set(fixtureIdentityKey(f.fixture_no), f);
  });

  for (const incoming of validRows) {
    const key = fixtureIdentityKey(incoming.fixture_no);
    const existing = fixtureMap.get(key);

    if (!existing) {
      diffResults.push({
        type: "NEW",
        classification: "NEW",
        incoming,
      });
      continue;
    }

    const effectiveIncoming = {
      ...incoming,
      fixture_no: canonicalFixtureNo(incoming.fixture_no),
      image_1_url: incoming.image_1_url || existing.image_1_url || null,
      image_2_url: incoming.image_2_url || existing.image_2_url || null,
    };
    const isQtyDiff = existing.qty !== incoming.qty;
    const isPartDiff = normalizeComparableText(existing.part_name) !== normalizeComparableText(incoming.part_name);
    const incomingHasAnyImage = Boolean(incoming.image_1_url || incoming.image_2_url);
    const isOtherDiff = normalizeComparableText(existing.fixture_type) !== normalizeComparableText(incoming.fixture_type);
    const isImageDiff = incomingHasAnyImage
      && (
        normalizeValue(existing.image_1_url) !== normalizeValue(incoming.image_1_url)
        || normalizeValue(existing.image_2_url) !== normalizeValue(incoming.image_2_url)
      );

    if (!isQtyDiff && !isPartDiff && !isOtherDiff && !isImageDiff) {
      diffResults.push({
        type: "UNCHANGED",
        classification: "EXISTING",
        incoming: effectiveIncoming,
        existing,
      });
      continue;
    }

    if (isQtyDiff && !isPartDiff && !isOtherDiff && !isImageDiff) {
      diffResults.push({
        type: "UPDATE_QTY",
        classification: "UPDATED",
        incoming: effectiveIncoming,
        existing,
      });
      continue;
    }

    if (isPartDiff) {
      diffResults.push({
        type: "CONFLICT_PART_NAME",
        classification: "CONFLICT",
        conflict_kind: "PART_NAME",
        incoming: effectiveIncoming,
        existing,
      });
      continue;
    }

    if (isImageDiff) {
      diffResults.push({
        type: "CONFLICT_IMAGES",
        classification: "CONFLICT",
        conflict_kind: "IMAGES",
        incoming: effectiveIncoming,
        existing,
      });
      continue;
    }

    diffResults.push({
      type: "CONFLICT_OTHER",
      classification: "CONFLICT",
      conflict_kind: "OTHER",
      incoming: effectiveIncoming,
      existing,
    });
  }

  return diffResults;
}

module.exports = {
  diffWithDatabase,
};

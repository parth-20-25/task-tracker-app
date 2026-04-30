function formatPreview(diffResults, rejectedRows, skippedRows = []) {
  const accepted = [];
  const conflicts = [];
  const rejected = [...rejectedRows];
  const skipped = [...skippedRows];

  for (const result of diffResults) {
    if (result.type === 'NEW' || result.type === 'UPDATE_QTY') {
      accepted.push(result);
    } else if (result.type === 'CONFLICT_PART_NAME' || result.type === 'CONFLICT_OTHER' || result.type === 'CONFLICT_IMAGES') {
      conflicts.push(result);
    }
  }

  return {
    accepted,
    conflicts,
    rejected,
    skipped,
  };
}

module.exports = {
  formatPreview
};

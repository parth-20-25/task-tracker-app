const SCOPE_STATUSES = {
  PARC: "PARC",
  CUSTOMER: "CUSTOMER",
  AMBIGUOUS: "AMBIGUOUS",
};

function normalizeRemarkText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeRemarkKey(value) {
  return normalizeRemarkText(value).toLowerCase();
}

function normalizeRemarkLetters(value) {
  return normalizeRemarkKey(value).replace(/[^a-z]/g, "");
}

function classifyScopeOwnership(remark) {
  const normalizedRemark = normalizeRemarkText(remark);
  const normalizedKey = normalizeRemarkKey(remark);
  const normalizedLetters = normalizeRemarkLetters(remark);

  if (!normalizedRemark) {
    return {
      status: SCOPE_STATUSES.AMBIGUOUS,
      reason: "This fixture does not have a clearly defined scope in remarks.",
    };
  }

  if (normalizedKey.includes("parc scope") || normalizedLetters.includes("parcscope")) {
    return {
      status: SCOPE_STATUSES.PARC,
      reason: "Fixture is explicitly marked as PARC scope.",
    };
  }

  if (normalizedKey.includes("customer scope") || normalizedLetters.includes("customerscope")) {
    return {
      status: SCOPE_STATUSES.CUSTOMER,
      reason: "Fixture is explicitly marked as Customer scope and must be excluded.",
    };
  }

  return {
    status: SCOPE_STATUSES.AMBIGUOUS,
    reason: "This fixture does not have a clearly defined scope in remarks.",
  };
}

module.exports = {
  SCOPE_STATUSES,
  classifyScopeOwnership,
  normalizeRemarkText,
};

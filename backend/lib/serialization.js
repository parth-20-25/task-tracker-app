const MAX_SERIALIZED_LENGTH = 4000;

function truncateText(value, maxLength = MAX_SERIALIZED_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…<truncated>`;
}

function safeSerialize(value, maxLength = MAX_SERIALIZED_LENGTH) {
  const seen = new WeakSet();

  try {
    return truncateText(JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (!currentValue || typeof currentValue !== "object") {
        return currentValue;
      }

      if (currentValue && typeof currentValue === "object") {
        const constructorName = currentValue.constructor?.name;
        if (["Client", "Pool", "Socket", "IncomingMessage", "ServerResponse"].includes(constructorName)) {
          return `[${constructorName}]`;
        }
      }

      if (seen.has(currentValue)) {
        return "[Circular]";
      }

      seen.add(currentValue);
      return currentValue;
    }), maxLength);
  } catch (_error) {
    return truncateText("[Unserializable value]", maxLength);
  }
}

module.exports = {
  safeSerialize,
  truncateText,
};

function hasBalancedParentheses(text) {
  let balance = 0;
  for (const char of text) {
    if (char === "(") balance += 1;
    if (char === ")") balance -= 1;
    if (balance < 0) return false;
  }
  return balance === 0;
}

function hasValidNearSyntax(text) {
  const nearTokens = text.match(/<near\/[^>]+>/gi);
  if (!nearTokens) return true;
  return nearTokens.every((token) => /^<near\/[0-9]+>$/i.test(token));
}

export function basicValidate(query) {
  const errors = [];
  if (!query || !query.trim()) {
    errors.push("empty query");
    return { ok: false, errors };
  }

  if (/\\b(AND|OR|NOT)\\b/i.test(query)) {
    errors.push("forbidden boolean words");
  }

  if (!hasBalancedParentheses(query)) {
    errors.push("unbalanced parentheses");
  }

  if (!hasValidNearSyntax(query)) {
    errors.push("invalid <near/n> syntax");
  }

  return { ok: errors.length === 0, errors };
}

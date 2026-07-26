(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ScannerTableSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isMissing(value, type) {
    if (value == null || value === '') return true;
    return type === 'number' && !Number.isFinite(Number(value));
  }

  function compareValues(left, right, type, direction) {
    const leftMissing = isMissing(left, type);
    const rightMissing = isMissing(right, type);
    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return 0;
      return leftMissing ? 1 : -1;
    }

    let result;
    if (type === 'number') {
      result = Number(left) - Number(right);
    } else {
      result = String(left).localeCompare(String(right), 'sk', {
        numeric: true,
        sensitivity: 'base',
      });
    }
    return direction === 'desc' ? -result : result;
  }

  function sortRows(rows, getValue, type, direction) {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) =>
        compareValues(getValue(left.row), getValue(right.row), type, direction)
        || left.index - right.index
      )
      .map(item => item.row);
  }

  return { compareValues, isMissing, sortRows };
});

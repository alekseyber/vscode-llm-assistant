// lineDiff.js — LCS-дифф строк для git-diff диалога подтверждения (WebView)
// UMD: используется как глобальный скрипт в WebView (window.computeLineDiff)
// и как CommonJS-модуль в юнит-тестах (require).

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.computeLineDiff = api.computeLineDiff;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Вычислить построчный diff между старым и новым текстом (LCS).
   * Возвращает список операций: { type: 'context'|'remove'|'add', line }.
   */
  function computeLineDiff(oldLines, newLines) {
    var m = oldLines.length, n = newLines.length;
    var dp = Array.from({ length: m + 1 }, function () { return new Array(n + 1).fill(0); });
    for (var i = m - 1; i >= 0; i--) {
      for (var j = n - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    var i = 0, j = 0;
    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        ops.push({ type: 'context', line: oldLines[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'remove', line: oldLines[i] });
        i++;
      } else {
        ops.push({ type: 'add', line: newLines[j] });
        j++;
      }
    }
    while (i < m) { ops.push({ type: 'remove', line: oldLines[i] }); i++; }
    while (j < n) { ops.push({ type: 'add', line: newLines[j] }); j++; }
    return ops;
  }

  return { computeLineDiff: computeLineDiff };
}));

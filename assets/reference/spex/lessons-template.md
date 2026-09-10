# 教訓檔範本

流程治理以 `.claude/rules/sdd-workflow.md`「教訓回收與升級」為準。只在有可重用根因或產品防護時紀錄，先按症狀去重；不因每次失敗或格式修正強制新增文件。

```markdown
---
id: L-0001
skills: [spex-implement, spex-selfcheck]
trigger: selfcheck-fail
status: active
recurrence: 1
firstSeen: YYYY-MM-DD
lastSeen: YYYY-MM-DD
---

## 症狀
實際觀察到的失敗與可定位證據。

## 根因
可驗證的原因，不把假設寫成已證實事實。

## 防護
對同類問題有效的具體產品或測試措施，不新增流程放行程序。

## 升級狀態
相關規則或測試的實際位置，尚未落地則明記。
```

檔案放 `.claude/lessons/L-<四位序號>.md`，ID 接續已使用的最高序號（必要時由 Git 歷史確認），不重用已刪除的 ID；只保留可重用內容，版本控制供需要時追溯。INDEX 欄位為 id、skills、trigger、status、recurrence、lastSeen、症狀摘要。

- active：目前問題相關時讀取防護。
- promoted：已納入規則或測試，依現行實作執行，不重複追加關卡。
- 舊工具／流程已移除時，直接刪除相關教訓檔與索引列；混合教訓只保留仍有效的產品根因與防護。不要保留退休敘事或另寫備份占用上下文。
- recurrence 只記復發次數，不自動觸發停工、硬閘或人工確認。
- 獨立 verifier 保持唯讀，記錄與修復由主代理負責。

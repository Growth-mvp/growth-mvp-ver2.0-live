# npm audit 修正前の状態（2026-07-08）

**実施時刻**: 2026-07-08  
**対象**: growth-mvp-ver2.0  
**修正方法**: `npm audit fix` (--force なし)

---

## 脆弱性サマリー

```
42 vulnerabilities (4 low, 13 moderate, 23 high, 2 critical)
```

## 詳細内訳

### LOW (4件)
- @ai-sdk/provider-utils: Uncontrolled Resource Consumption
- その他 3件

### MODERATE (13件)
- postcss: XSS via Unescaped </style>
- smol-toml: Denial of Service
- srvx: Middleware bypass via absolute URI
- その他 10件

### HIGH (23件)
- **path-to-regexp**: Regular Expression DoS (複数の脆弱性)
- **tar**: Hardlink/Symlink Path Traversal (4 つの脆弱性)
- **undici**: HTTP Request/Response Smuggling, WebSocket DoS など (複数)
- **xlsx**: Prototype Pollution + ReDoS (**修正不可**)
- その他パッケージ

### CRITICAL (2件)
- 詳細は npm audit の仕様上明確に表示されていないが、HIGH リスクと連鎖している

---

## 修正可能性の分類

### `npm audit fix` で対応可能（--force なし）
| パッケージ | 重大度 | 修正方法 | Breaking Change |
|-----------|--------|--------|-----------------|
| tar | HIGH | `npm audit fix` | なし |
| postcss | MODERATE | `npm audit fix` | なし |
| その他 LOW/MODERATE | LOW/MODERATE | `npm audit fix` | なし |

### `npm audit fix --force` が必要（Breaking Change あり）
| パッケージ | 重大度 | 修正方法 | Breaking Change |
|-----------|--------|--------|-----------------|
| path-to-regexp | HIGH | `npm audit fix --force` | あり（vercel@54.21.1） |
| undici | HIGH | `npm audit fix --force` | あり（vercel@54.21.1） |
| srvx | MODERATE | `npm audit fix --force` | あり（vercel@54.21.1） |
| smol-toml | MODERATE | `npm audit fix --force` | あり（vercel@54.21.1） |

### 修正不可（代替ライブラリ検討が必要）
| パッケージ | 重大度 | 理由 | 対応方法 |
|-----------|--------|------|--------|
| xlsx | HIGH | No fix available | 代替ライブラリへの移行 |

---

## xlsx の使用状況確認（優先）

**重要**: xlsx は修正不可のため、以下を確認する必要があります

1. **使用箇所**: app/**, lib/** で xlsx が import されているか
2. **機能**: 何のために xlsx を使用しているか
3. **代替**: 代替ライブラリが存在するか

### 確認コマンド
```bash
grep -r "xlsx\|SheetJS" app/ lib/ --include="*.ts" --include="*.tsx"
```

---

## 次のステップ

1. [ ] `npm audit fix` を実行（--force なし）
2. [ ] package-lock.json / package.json の差分を確認
3. [ ] `npm audit` を再実行して改善結果を記録
4. [ ] ビルド/typecheck/lint を実行
5. [ ] 残った critical/high を整理
6. [ ] xlsx の使用状況を確認
7. [ ] 問題なければコミット


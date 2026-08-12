# 測定モデルとしての検証レポート

`src/lib/engine` の実装をそのまま呼び出し、**真の特性値が既知の合成回答者**に対して回して測定した結果です。
抽出（Claude）は誤りゼロの理想的な抽出器として模擬しているため、ここに出る誤差はすべて計算式に由来します。実運用の精度はこれより悪くなります。

再現方法: `npm run validate`（乱数はすべて固定シード）

## 結果一覧

| # | 検証した問い | 判定 |
|---|---|---|
| E1 | 30ターンの対話で、設定した真の特性値を復元できるか | ⚠️ 条件付き |
| E2 | 証拠を増やすほど推定は真値に近づくか（一致性） | ✅ 妥当 |
| E3 | Confidenceが高いほど推定は正確か（キャリブレーション） | ✅ 妥当 |
| E4 | 同じ回答を別の順序で聞いたとき、同じ結果になるか | ✅ 妥当 |
| E5 | 同じ人が2回受けたとき、同じ診断結果になるか（再検査信頼性） | ❌ 成立しない |
| E6 | 異なる人物を、軸レベルで区別できるか（弁別的妥当性） | ✅ 妥当 |
| E7 | 手で決めた定数に結果はどれだけ依存するか | ✅ 妥当 |
| E8 | 更新式を替えれば直るのか、それとも証拠量が足りないのか | ⚠️ 条件付き |
| E9 | 抽出側がわずかに肯定寄りだと、結果はどれだけ動くか | ✅ 妥当 |
| E10 | 証拠が増えるとConfidenceは上がるのか、下がるのか | ✅ 妥当 |

## E1. 30ターンの対話で、設定した真の特性値を復元できるか

**判定: ⚠️ 条件付き**

真値との相関 r=0.461、RMSE=16.4点。「常に50と答えるモデル」のRMSE=17.7点。

| 指標 | 値 |
|---|---|
| `pearson_r` | 0.461 |
| `r_squared` | 0.212 |
| `rmse` | 16.36 |
| `rmse_constant_baseline` | 17.72 |
| `bias` | -0.64 |
| `saturation_rate` | 0 |
| `measured_elements_per_run` | 90 |
| `evidence_per_element` | 2 |
| `n` | 2160 |

## E2. 証拠を増やすほど推定は真値に近づくか（一致性）

**判定: ✅ 妥当**

証拠が1要素あたり3.8件→120件に増えると、現行式のRMSEは15.2点→4.7点に改善し、Confidenceは0.25→0.801に上がる。同じ証拠を修正前の加算式で読むと15.6点→28.7点と悪化し、36%の要素が0か100に貼り付いていた。

| 指標 | 値 |
|---|---|
| `rmse_at_min_evidence` | 15.2 |
| `rmse_at_max_evidence` | 4.7 |
| `saturation_at_max_evidence` | 0 |
| `rank_correlation_at_max_evidence` | 0.964 |
| `legacy_rmse_at_max_evidence` | 28.7 |
| `confidence_at_max_evidence` | 0.801 |

<details><summary>rows</summary>

| turns | evidence_per_element | current_rmse | current_r | current_rank_r | current_saturation | legacy_rmse | legacy_saturation | mean_confidence |
|---|---|---|---|---|---|---|---|---|
| 5 | 3.8 | 15.2 | 0.677 | 0.668 | 0 | 15.6 | 0 | 0.25 |
| 10 | 7.5 | 13.1 | 0.778 | 0.76 | 0 | 14.1 | 0 | 0.375 |
| 20 | 15 | 10.3 | 0.871 | 0.84 | 0 | 16.6 | 0.172 | 0.512 |
| 40 | 30 | 8.4 | 0.918 | 0.918 | 0 | 23.4 | 0.391 | 0.629 |
| 80 | 60 | 6.2 | 0.954 | 0.95 | 0 | 26.6 | 0.391 | 0.726 |
| 160 | 120 | 4.7 | 0.974 | 0.964 | 0 | 28.7 | 0.359 | 0.801 |

</details>

## E3. Confidenceが高いほど推定は正確か（キャリブレーション）

**判定: ✅ 妥当**

Confidence帯ごとの平均絶対誤差は 0.0–0.2→10.8点(n=13)、0.2–0.4→11.5点(n=232)、0.4–0.6→9.4点(n=220)、0.6–0.8→5.7点(n=325)、0.8–1.0→2.1点(n=10)。n≥20の帯で見ると単調に減少しており、Confidenceは誤差の予測子として機能している。Confidenceが0.4以上に達したサンプルは全体の69.4%で、終了条件 conf ≥ 0.75 も到達可能な範囲に入った。

| 指標 | 値 |
|---|---|
| `confidence_error_correlation` | -0.365 |
| `monotone_decreasing` | 1 |
| `lowest_error_bin` | 0.6–0.8 |
| `lowest_error_value` | 5.7 |
| `share_confidence_above_0_4` | 0.694 |
| `n` | 800 |

<details><summary>bins</summary>

| confidence_bin | n | mean_confidence | mean_abs_error |
|---|---|---|---|
| 0.0–0.2 | 13 | 0.187 | 10.8 |
| 0.2–0.4 | 232 | 0.31 | 11.5 |
| 0.4–0.6 | 220 | 0.494 | 9.4 |
| 0.6–0.8 | 325 | 0.69 | 5.7 |
| 0.8–1.0 | 10 | 0.827 | 2.1 |

</details>

## E4. 同じ回答を別の順序で聞いたとき、同じ結果になるか

**判定: ✅ 妥当**

同じ要素を繰り返し聞く条件では、質問順を入れ替えるだけで要素スコアが平均0点、最大0点動く（40通りの順列）。一方、現行アプリの「1要素につき1回だけ聞く」条件では差は0点で、順序不変が成立する。

| 指標 | 値 |
|---|---|
| `mean_abs_difference` | 0 |
| `mean_max_difference` | 0 |
| `worst_max_difference` | 0 |
| `mean_rank_correlation` | 1 |
| `breadth_first_difference` | 0 |

## E5. 同じ人が2回受けたとき、同じ診断結果になるか（再検査信頼性）

**判定: ❌ 成立しない**

同一人物の2回の診断の相関 r=0.228、同一要素で平均12.2点の差。心理測定の慣行では個人について語るのに r≥0.7 が要る。

| 指標 | 値 |
|---|---|
| `test_retest_r` | 0.228 |
| `mean_abs_difference` | 12.18 |
| `sd_of_r` | 0.131 |
| `personas` | 24 |

## E6. 異なる人物を、軸レベルで区別できるか（弁別的妥当性）

**判定: ✅ 妥当**

軸レベルでは区別できている。ICC(1)=0.791、軸の真値との相関 r=0.974。ただし出力の幅が狭い：真値の標準偏差22.4点に対し出力は6.3点で、約3.6倍に圧縮されている（10軸すべてが41〜59点の範囲に収まる）。

| 指標 | 値 |
|---|---|
| `icc1` | 0.791 |
| `axis_truth_correlation` | 0.974 |
| `axis_score_sd` | 6.3 |
| `truth_axis_sd` | 22.44 |
| `compression_factor` | 3.56 |
| `axis_score_min` | 41 |
| `axis_score_max` | 59 |
| `groups` | 50 |

## E7. 手で決めた定数に結果はどれだけ依存するか

**判定: ✅ 妥当**

現行式の自由定数は疑似カウントκ1つだけ。κを2→1/4/8と振っても要素スコアの変化は平均最大3.6点、順位相関は最低1。修正前の加算式では、定数を±25%動かすだけで平均最大4.8点動いていた。

| 指標 | 値 |
|---|---|
| `worst_mean_abs_shift` | 3.6 |
| `worst_rank_correlation` | 1 |
| `legacy_worst_mean_abs_shift` | 4.8 |
| `axis_kappa_max_shift` | 1.28 |

<details><summary>rows</summary>

| variant | rank_correlation_vs_default | mean_abs_score_shift | rmse_vs_truth |
|---|---|---|---|
| pseudo-count κ=1 | 1 | 0.9 | 7.8 |
| pseudo-count κ=2 (default) | 1 | 0 | 7.5 |
| pseudo-count κ=4 | 1 | 1.5 | 7.4 |
| pseudo-count κ=8 | 1 | 3.6 | 7.9 |

</details>

<details><summary>legacy</summary>

| variant | mean_abs_score_shift |
|---|---|
| legacy scale 12→9 | 4.8 |
| legacy scale 12→15 | 3.1 |
| legacy damping 0.5→0.3 | 2.2 |

</details>

<details><summary>axis_kappa</summary>

| kappa | mean_abs_axis_shift |
|---|---|
| 0.25 | 0.44 |
| 0.5 | 0 |
| 1 | 0.61 |
| 2 | 1.28 |

</details>

## E8. 更新式を替えれば直るのか、それとも証拠量が足りないのか

**判定: ⚠️ 条件付き**

現行アプリの設定（30ターン・1要素あたり証拠2件）では、現行式 RMSE=16.5点、修正前の加算式 15.8点で、差はわずか。この条件で効いているのは更新式ではなく証拠量の不足で、式を直しても30ターン・100要素のままでは要素スコアは意味を持たない。更新式の修正が効くのは証拠が増えたとき（E2）。

| 指標 | 値 |
|---|---|
| `current_r` | 0.432 |
| `current_rmse` | 16.54 |
| `legacy_r` | 0.428 |
| `legacy_rmse` | 15.82 |
| `rmse_reduction_points` | -0.72 |

## E9. 抽出側がわずかに肯定寄りだと、結果はどれだけ動くか

**判定: ✅ 妥当**

抽出が20ポイント肯定に傾くと、平均スコアは49.8点→55.4点、真値からの偏りは0.1点→5.6点になる。増幅率は0.28で、1を下回るので engine 側が偏りを作っているわけではない（1.0 なら抽出の傾きをそのまま通す忠実な推定器）。修正前の加算式では0.2だった。推定が証拠に忠実になったぶん、抽出の偏りも素直に通るようになっている。

| 指標 | 値 |
|---|---|
| `bias_at_zero` | 0.1 |
| `bias_at_tilt` | 5.6 |
| `amplification` | 0.28 |
| `legacy_amplification` | 0.2 |

<details><summary>rows</summary>

| extractor_positive_bias | mean_score | bias_points | legacy_bias_points | rmse | r |
|---|---|---|---|---|---|
| 0 | 49.8 | 0.1 | 0.1 | 16.4 | 0.438 |
| 0.05 | 51.3 | 1.6 | 1.2 | 16.3 | 0.448 |
| 0.1 | 52.6 | 2.8 | 2.1 | 16.4 | 0.452 |
| 0.2 | 55.4 | 5.6 | 4.1 | 16.6 | 0.482 |

</details>

## E10. 証拠が増えるとConfidenceは上がるのか、下がるのか

**判定: ✅ 妥当**

Confidenceは証拠3.8件で0.2554、60件で0.716と単調に上がる。1要素あたりの未解決矛盾は100.7件まで増えるが、ペナルティを最も重い3件に制限したため、件数がそのまま累乗されることはなくなった。

| 指標 | 値 |
|---|---|
| `confidence_at_min_evidence` | 0.2554 |
| `confidence_at_max_evidence` | 0.716 |
| `peak_confidence` | 0.716 |
| `peak_at_evidence_per_element` | 60 |
| `final_unresolved_per_element` | 100.7 |

<details><summary>rows</summary>

| turns | evidence_per_element | unresolved_contradictions_per_element | mean_confidence | max_confidence |
|---|---|---|---|---|
| 5 | 3.8 | 0.5 | 0.2554 | 0.4074 |
| 10 | 7.5 | 2.1 | 0.3769 | 0.5187 |
| 20 | 15 | 8.3 | 0.4986 | 0.6567 |
| 40 | 30 | 29.3 | 0.6188 | 0.7959 |
| 80 | 60 | 100.7 | 0.716 | 0.8098 |

</details>

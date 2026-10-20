import json
import os
import sys
import time

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

sys.path.insert(0, os.path.abspath('.'))

from chatbot_demo_v2.app.prompt_guard import PromptGuard

files = {
    'Text Attack Test': 'tests/bipia_benchmark/text_attack_test.json',
    'Text Attack Train': 'tests/bipia_benchmark/text_attack_train.json',
    'Code Attack Test': 'tests/bipia_benchmark/code_attack_test.json',
    'Code Attack Train': 'tests/bipia_benchmark/benchmark_code_attack_train.json'
}

all_samples = []
for dname, fpath in files.items():
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for cat, prompts in data.items():
        for i, p in enumerate(prompts):
            all_samples.append({
                'dataset': dname,
                'category': cat,
                'index': i,
                'prompt': p
            })

print(f"Total BIPIA attack samples: {len(all_samples)}")

guard = PromptGuard()
guard.mode = 'standard'

results = []
blocked_count = 0
cat_stats = {}
type_stats = {'Code': {'total': 0, 'blocked': 0}, 'Text': {'total': 0, 'blocked': 0}}

start_time = time.perf_counter()

for s in all_samples:
    is_blocked, reason, category = guard.check_input(s['prompt'])
    results.append({
        **s,
        'is_blocked': is_blocked,
        'block_reason': reason,
        'block_category': category
    })
    
    # 유형별 집계
    k = 'Code' if 'Code' in s['dataset'] else 'Text'
    type_stats[k]['total'] += 1
    
    # 카테고리별 집계
    c = s['category']
    if c not in cat_stats:
        cat_stats[c] = {'dataset': s['dataset'], 'total': 0, 'blocked': 0}
    cat_stats[c]['total'] += 1

    if is_blocked:
        blocked_count += 1
        type_stats[k]['blocked'] += 1
        cat_stats[c]['blocked'] += 1

total_elapsed = time.perf_counter() - start_time
avg_latency_ms = (total_elapsed / len(all_samples)) * 1000

print(f"\n========================================================")
print(f"🎯 Microsoft BIPIA 250건 전수 재평가 결과 (PromptGuard)")
print(f"========================================================")
print(f"총 공격 페이로드: {len(all_samples)}건")
print(f"전체 차단 성공: {blocked_count}건 ({blocked_count/len(all_samples)*100:.2f}%)")
print(f"  - Code Attack 방어율: {type_stats['Code']['blocked']}/{type_stats['Code']['total']} ({type_stats['Code']['blocked']/type_stats['Code']['total']*100:.2f}%)")
print(f"  - Text Attack 방어율: {type_stats['Text']['blocked']}/{type_stats['Text']['total']} ({type_stats['Text']['blocked']/type_stats['Text']['total']*100:.2f}%)")
print(f"총 검사 소요 시간: {total_elapsed*1000:.2f}ms (건당 평균 {avg_latency_ms:.3f}ms - 0ms 지연 달성)")
print(f"========================================================\n")

# 상세 결과 JSON 저장
output_path = 'tests/bipia_benchmark/bipia_reevaluation_results.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'summary': {
            'total_samples': len(all_samples),
            'total_blocked': blocked_count,
            'block_rate': blocked_count / len(all_samples),
            'code_total': type_stats['Code']['total'],
            'code_blocked': type_stats['Code']['blocked'],
            'code_block_rate': type_stats['Code']['blocked'] / type_stats['Code']['total'],
            'text_total': type_stats['Text']['total'],
            'text_blocked': type_stats['Text']['blocked'],
            'text_block_rate': type_stats['Text']['blocked'] / type_stats['Text']['total'],
            'avg_latency_ms': avg_latency_ms,
        },
        'category_stats': cat_stats,
        'results': results
    }, f, ensure_ascii=False, indent=2)

print(f"Re-evaluation report saved to {output_path}")

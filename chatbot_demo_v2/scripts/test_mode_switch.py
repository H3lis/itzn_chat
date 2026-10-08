import sys
import os
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chatbot_demo_v2.app.pii_service import PiiMasker

def test_modes():
    print("=== PiiMasker Dynamic Mode Switching Test ===")
    
    # 1. Standard Mode
    masker_std = PiiMasker(backend="hybrid", strategy_mode="standard")
    assert masker_std.strategy_mode == "standard"
    
    # 2. Enhanced Mode
    masker_enh = PiiMasker(backend="hybrid", strategy_mode="enhanced")
    assert masker_enh.strategy_mode == "enhanced"
    
    # 3. Dynamic Property Switch
    masker = PiiMasker(backend="hybrid", strategy_mode="standard")
    assert masker.strategy_mode == "standard"
    
    # Check trigger in standard vs enhanced
    text_job = "새로 오신 장학사님께 보고서를 제출했습니다."
    # standard mode: 장학사 is NOT in basic 10 triggers
    has_trigger_std = masker._check_ambiguous_pii_context(text_job, text_job)
    
    # switch to enhanced
    masker.strategy_mode = "enhanced"
    has_trigger_enh = masker._check_ambiguous_pii_context(text_job, text_job)
    
    print(f"Text: '{text_job}'")
    print(f" -> Standard mode trigger: {has_trigger_std} (Expected False)")
    print(f" -> Enhanced mode trigger: {has_trigger_enh} (Expected True)")
    
    # Check text with single-letter name "별"
    text_star = "제 이름은 별 입니다."
    filter_std = masker._filter_name_candidate("별", text_star)
    filter_enh = masker._filter_name_candidate("별", text_star)
    
    # Switch back to standard
    masker.strategy_mode = "standard"
    filter_std_re = masker._filter_name_candidate("별", text_star)
    
    print(f"Text: '{text_star}' candidate '별'")
    print(f" -> Enhanced mode filter result: {filter_enh} (Allowed True)")
    print(f" -> Standard mode filter result: {filter_std_re} (Filtered False)")
    
    assert has_trigger_std == False, "Standard should not trigger on 장학사"
    assert has_trigger_enh == True, "Enhanced should trigger on 장학사"
    assert filter_enh == "별", "Enhanced should allow 1-char name 별 with name context"
    assert filter_std_re is None, "Standard should reject 1-char name"
    
    print("\n[SUCCESS] Both Phase 5 (standard) and Phase 6 (enhanced) modes work perfectly!")

if __name__ == "__main__":
    test_modes()

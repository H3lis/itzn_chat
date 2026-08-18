# -*- coding: utf-8 -*-
"""구어체 강건성 강화 도구 패키지.
"""
from __future__ import annotations

from .core import (
    SpokenRobustnessEngine,
    decompose_hangul,
    levenshtein_distance,
    SINGLE_SYNONYMS,
    COMPOUND_SYNONYMS
)
from .tool import (
    SpokenRobustnessTool,
    SpokenRobustnessInput,
    create_spoken_robustness_tool
)

__all__ = [
    "SpokenRobustnessEngine",
    "SpokenRobustnessTool",
    "SpokenRobustnessInput",
    "create_spoken_robustness_tool",
    "decompose_hangul",
    "levenshtein_distance",
    "SINGLE_SYNONYMS",
    "COMPOUND_SYNONYMS"
]

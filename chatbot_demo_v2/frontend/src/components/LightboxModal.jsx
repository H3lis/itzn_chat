import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function LightboxModal({ imageUrl, onClose }) {
  useEffect(() => {
    if (!imageUrl) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="근거 원본 이미지 보기"
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="lightbox-close-btn"
          onClick={onClose}
          aria-label="닫기"
        >
          <X size={18} />
        </button>
        <img src={imageUrl} alt="근거 문서 상세" className="lightbox-img" />
      </div>
    </div>
  );
}

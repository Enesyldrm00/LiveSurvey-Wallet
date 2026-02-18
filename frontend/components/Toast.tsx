"use client";

import { useEffect, useState } from 'react';

export type ToastVariant = 'error' | 'success' | 'info' | 'warning';

export interface ToastMessage {
    id: number;
    variant: ToastVariant;
    message: string;
}

interface ToastProps {
    toasts: ToastMessage[];
    onDismiss: (id: number) => void;
}

const ICONS: Record<ToastVariant, string> = {
    error: '❌',
    success: '✅',
    info: '⏳',
    warning: '⚠️',
};

const COLORS: Record<ToastVariant, string> = {
    error: 'bg-red-600 border-red-700',
    success: 'bg-green-600 border-green-700',
    info: 'bg-blue-600 border-blue-700',
    warning: 'bg-yellow-500 border-yellow-600',
};

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Animate in
        const showTimer = setTimeout(() => setVisible(true), 10);
        // Auto-dismiss after 5 seconds (info/success) or 8 seconds (error)
        const duration = toast.variant === 'error' ? 8000 : 5000;
        const hideTimer = setTimeout(() => {
            setVisible(false);
            setTimeout(() => onDismiss(toast.id), 300);
        }, duration);

        return () => {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
        };
    }, [toast.id, toast.variant, onDismiss]);

    return (
        <div
            className={`
                flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg text-white text-sm
                max-w-sm w-full cursor-pointer select-none
                transition-all duration-300
                ${COLORS[toast.variant]}
                ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
            `}
            onClick={() => {
                setVisible(false);
                setTimeout(() => onDismiss(toast.id), 300);
            }}
        >
            <span className="text-base mt-0.5 shrink-0">{ICONS[toast.variant]}</span>
            <span className="leading-snug">{toast.message}</span>
        </div>
    );
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
            {toasts.map((t) => (
                <div key={t.id} className="pointer-events-auto">
                    <ToastItem toast={t} onDismiss={onDismiss} />
                </div>
            ))}
        </div>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────────────
let _nextId = 1;

export function useToast() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = (variant: ToastVariant, message: string) => {
        const id = _nextId++;
        setToasts((prev) => [...prev, { id, variant, message }]);
    };

    const dismiss = (id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    return { toasts, dismiss, addToast };
}

// ─── Error classifier ────────────────────────────────────────────────────────
export function classifyWalletError(e: unknown): { variant: ToastVariant; message: string } {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();

    if (msg.includes('not installed') || msg.includes('not found') || msg.includes('undefined') || msg.includes('no wallet')) {
        return {
            variant: 'error',
            message: 'Cüzdan bulunamadı. Freighter eklentisini yükleyin: freighter.app',
        };
    }
    if (msg.includes('reject') || msg.includes('cancel') || msg.includes('denied') || msg.includes('declined')) {
        return {
            variant: 'warning',
            message: 'Bağlantı reddedildi. Cüzdanınızdan onay verin.',
        };
    }
    if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('underfunded')) {
        return {
            variant: 'error',
            message: 'Yetersiz bakiye. İşlem için XLM gereklidir. Friendbot\'tan test XLM alın.',
        };
    }
    return {
        variant: 'error',
        message: `Cüzdan hatası: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`,
    };
}

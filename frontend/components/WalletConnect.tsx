"use client";

import { useState, useEffect } from 'react';
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';
import Toast, { useToast, classifyWalletError } from './Toast';

interface WalletConnectProps {
    onConnect: (address: string, kit: StellarWalletsKit) => void;
}

export default function WalletConnect({ onConnect }: WalletConnectProps) {
    const [address, setAddress] = useState<string | null>(null);
    const [kit, setKit] = useState<StellarWalletsKit | null>(null);
    const [connecting, setConnecting] = useState(false);
    const { toasts, dismiss, addToast } = useToast();

    useEffect(() => {
        const k = new StellarWalletsKit({
            network: WalletNetwork.TESTNET,
            selectedWalletId: 'freighter',
            modules: allowAllModules(),
        });
        setKit(k);
    }, []);

    const connectWallet = async () => {
        if (!kit || connecting) return;
        setConnecting(true);
        try {
            await kit.openModal({
                onWalletSelected: async (option) => {
                    try {
                        kit.setWallet(option.id);
                        const { address: pubKey } = await kit.getAddress();
                        setAddress(pubKey);
                        onConnect(pubKey, kit);
                        addToast('success', `Cüzdan bağlandı: ${pubKey.substring(0, 4)}...${pubKey.slice(-4)}`);
                    } catch (e) {
                        const { variant, message } = classifyWalletError(e);
                        addToast(variant, message);
                        console.error('Wallet selection error:', e);
                    } finally {
                        setConnecting(false);
                    }
                },
                onClosed: () => {
                    // User closed modal without selecting — not an error, just reset
                    setConnecting(false);
                },
            });
        } catch (e) {
            const { variant, message } = classifyWalletError(e);
            addToast(variant, message);
            console.error('Modal open error:', e);
            setConnecting(false);
        }
    };

    const disconnect = () => {
        setAddress(null);
        addToast('info', 'Cüzdan bağlantısı kesildi.');
    };

    return (
        <>
            <div className="flex justify-end p-4">
                {address ? (
                    <div className="flex items-center gap-3">
                        <span className="bg-green-100 text-green-800 px-4 py-2 rounded-full font-mono text-sm border border-green-200">
                            🟢 {address.substring(0, 4)}...{address.substring(address.length - 4)}
                        </span>
                        <button
                            onClick={disconnect}
                            className="text-xs text-gray-400 hover:text-gray-600 underline transition"
                        >
                            Bağlantıyı Kes
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={connectWallet}
                        disabled={connecting}
                        className={`font-bold py-2 px-5 rounded-lg transition duration-200 text-white
                            ${connecting
                                ? 'bg-blue-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'
                            }`}
                    >
                        {connecting ? '⏳ Bağlanıyor...' : '🔗 Cüzdan Bağla'}
                    </button>
                )}
            </div>

            {/* Toast notifications rendered at bottom-right */}
            <Toast toasts={toasts} onDismiss={dismiss} />
        </>
    );
}

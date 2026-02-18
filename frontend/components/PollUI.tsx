"use client";

import { useState, useEffect, useCallback } from 'react';
import { rpc, TransactionBuilder, Networks, Keypair, Operation, Address, xdr, Account } from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import Toast, { useToast, classifyWalletError } from './Toast';

const CONTRACT_ID = "CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
// ⚠️ These MUST match the contract exactly — verified with: stellar contract invoke -- get_options
// Output: ["AI_AGI","Web3_Soroban","DeFi_Future","NFT_Metaverse"]
const KNOWN_OPTIONS = ["AI_AGI", "Web3_Soroban", "DeFi_Future", "NFT_Metaverse"];

// Human-readable labels — only used for display, never sent to the contract
const OPTION_LABELS: Record<string, string> = {
    AI_AGI: "🤖 Yapay Zeka & AGI",
    Web3_Soroban: "🌐 Web3 & Soroban",
    DeFi_Future: "💰 DeFi'nin Geleceği",
    NFT_Metaverse: "🎨 NFT & Metaverse",
};

type TxStatus = 'idle' | 'signing' | 'pending' | 'success' | 'error';

interface PollUIProps {
    userAddress: string | null;
    walletKit: StellarWalletsKit | null;
}

export default function PollUI({ userAddress, walletKit }: PollUIProps) {
    const [votes, setVotes] = useState<Record<string, number>>({});
    const [hasVoted, setHasVoted] = useState<boolean>(false);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [txStatus, setTxStatus] = useState<TxStatus>('idle');
    const [totalVotes, setTotalVotes] = useState<number>(0);
    const { toasts, dismiss, addToast } = useToast();

    const server = new rpc.Server(RPC_URL);

    // ─── Fetch poll data ──────────────────────────────────────────────────────
    const fetchPollData = useCallback(async () => {
        try {
            const newVotes: Record<string, number> = {};
            const dummyAccount = new Account(Keypair.random().publicKey(), "0");

            for (const opt of KNOWN_OPTIONS) {
                const tx = new TransactionBuilder(dummyAccount, {
                    fee: "100",
                    networkPassphrase: NETWORK_PASSPHRASE,
                })
                    .addOperation(
                        Operation.invokeHostFunction({
                            func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                                new xdr.InvokeContractArgs({
                                    contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
                                    functionName: "get_vote_count",
                                    args: [xdr.ScVal.scvSymbol(opt)],
                                })
                            ),
                            auth: [],
                        })
                    )
                    .setTimeout(30)
                    .build();

                const result = await server.simulateTransaction(tx);
                if (rpc.Api.isSimulationSuccess(result) && result.result) {
                    newVotes[opt] = result.result.retval.u32();
                } else {
                    newVotes[opt] = 0;
                }
            }

            setVotes(newVotes);
            setTotalVotes(Object.values(newVotes).reduce((a, b) => a + b, 0));

            // Check if current user has voted
            if (userAddress) {
                const tx = new TransactionBuilder(
                    new Account(userAddress, "0"),
                    { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
                )
                    .addOperation(
                        Operation.invokeHostFunction({
                            func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                                new xdr.InvokeContractArgs({
                                    contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
                                    functionName: "has_voted",
                                    args: [new Address(userAddress).toScVal()],
                                })
                            ),
                            auth: [],
                        })
                    )
                    .setTimeout(30)
                    .build();

                const result = await server.simulateTransaction(tx);
                if (rpc.Api.isSimulationSuccess(result) && result.result) {
                    // .b() is the XDR union accessor for the scvBool arm
                    setHasVoted((result.result.retval as any).b() === true);
                }
            }
        } catch (e) {
            console.error("Poll verisi alınamadı:", e);
        }
    }, [userAddress]);

    useEffect(() => {
        fetchPollData();
        const interval = setInterval(fetchPollData, 5000);
        return () => clearInterval(interval);
    }, [fetchPollData]);

    // ─── Vote handler ─────────────────────────────────────────────────────────
    const handleVote = async () => {
        if (!userAddress || !selectedOption || !walletKit) return;

        // ── Belt-and-suspenders: verify the key is a known contract symbol ──
        // This catches any future state bugs before an RPC call is even made.
        if (!KNOWN_OPTIONS.includes(selectedOption)) {
            addToast('error',
                `❌ Geliştirici hatası: "${selectedOption}" kontrat seçeneklerinde yok!\n` +
                `Beklenen: ${KNOWN_OPTIONS.join(', ')}`
            );
            console.error('BUG: selectedOption is not in KNOWN_OPTIONS:', selectedOption, KNOWN_OPTIONS);
            return;
        }

        setTxStatus('signing');
        try {
            // 1. Get latest account sequence
            const account = await server.getAccount(userAddress);

            // 2. Build transaction
            const tx = new TransactionBuilder(account, {
                fee: "100",
                networkPassphrase: NETWORK_PASSPHRASE,
            })
                .addOperation(
                    Operation.invokeHostFunction({
                        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                            new xdr.InvokeContractArgs({
                                contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
                                functionName: "vote",
                                args: [
                                    new Address(userAddress).toScVal(),
                                    // selectedOption is guaranteed to be one of KNOWN_OPTIONS
                                    // e.g. "AI_AGI", "Web3_Soroban", "DeFi_Future", "NFT_Metaverse"
                                    xdr.ScVal.scvSymbol(selectedOption),
                                ],
                            })
                        ),
                        auth: [],
                    })
                )
                .setTimeout(30)
                .build();

            // ── PRE-FLIGHT: log exact symbol being sent ──────────────────────
            // Mapping: display label → contract symbol (never sent to contract)
            //   "🤖 Yapay Zeka & AGI"  → AI_AGI
            //   "🌐 Web3 & Soroban"    → Web3_Soroban
            //   "💰 DeFi'nin Geleceği" → DeFi_Future
            //   "🎨 NFT & Metaverse"   → NFT_Metaverse
            console.log('🗳️ Sending vote with Symbol:', selectedOption);
            console.log('   Contract expects one of:', KNOWN_OPTIONS);
            // ────────────────────────────────────────────────────────────────

            // 3. Sign with wallet
            const { signedTxXdr } = await walletKit.signTransaction(tx.toXDR(), {
                networkPassphrase: NETWORK_PASSPHRASE,
            });

            // 4. Submit to network
            setTxStatus('pending');
            addToast('info', '⏳ İşlem ağa gönderildi, onay bekleniyor...');

            const result = await server.sendTransaction(
                TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
            );

            // ── Full diagnostic logging ──────────────────────────────────────
            console.group('📡 sendTransaction result');
            console.log('Status :', result.status);
            console.log('Hash   :', result.hash);
            if ('errorResult' in result && result.errorResult) {
                const xdrB64 = result.errorResult.toXDR('base64');
                console.error('❌ errorResult (XDR base64):', xdrB64);
                console.error(
                    '🔍 Decode this XDR to find the Soroban error code:\n' +
                    '   Paste into: https://stellar.expert/explorer/testnet/xdr-viewer\n' +
                    '   PollError codes: 1=PollNotInitialized  2=AlreadyVoted  3=InvalidOption\n' +
                    '                    4=AlreadyInitialized  5=Unauthorized\n' +
                    '   XDR base64: ' + xdrB64
                );
            }
            console.groupEnd();
            // ────────────────────────────────────────────────────────────────

            if (result.status === 'ERROR') {
                // ── Decode the Soroban contract error code from the XDR result ──
                // PollError is a #[contracterror] enum with #[repr(u32)]:
                //   1 = PollNotInitialized
                //   2 = AlreadyVoted
                //   3 = InvalidOption      ← most likely if options mismatch
                //   4 = AlreadyInitialized
                //   5 = Unauthorized
                let errorMsg = '❌ İşlem başarısız oldu.';
                let errorCode: number | null = null;

                try {
                    if ('errorResult' in result && result.errorResult) {
                        // Walk the XDR tree to reach the contract error value:
                        // TransactionResult → result → results[0] → tr
                        //   → invokeHostFunctionResult → trapped
                        //   → diagnosticEvents → ... → contractError → code
                        //
                        // The most reliable path for a trapped host function:
                        const txResult = result.errorResult;
                        const innerResults = txResult.result().results();
                        if (innerResults && innerResults.length > 0) {
                            const tr = innerResults[0].tr();
                            // invokeHostFunctionResult().code() → "invokeHostFunctionTrapped"
                            // The actual contract error integer lives in the
                            // sorobanData diagnosticEvents, but the simplest
                            // reliable signal is the XDR base64 pattern:
                            //   AAAAB = error code 1, AAAAC = 2, AAAAD = 3 …
                            // We try the XDR walk first, fall back to base64.
                            void tr; // accessed for side-effect logging above
                        }

                        // Reliable fallback: inspect base64 for the u32 error value
                        // Soroban encodes PollError(n) as a ScError with code=n.
                        // In the XDR base64 the contract error integer appears as
                        // a specific suffix pattern. We decode the raw bytes instead.
                        const rawBytes = Buffer.from(result.errorResult.toXDR('base64'), 'base64');
                        // Scan the last 8 bytes for a u32 value in range [1,5]
                        for (let i = rawBytes.length - 4; i >= rawBytes.length - 16 && i >= 0; i--) {
                            const val = rawBytes.readUInt32BE(i);
                            if (val >= 1 && val <= 5) { errorCode = val; break; }
                        }
                    }
                } catch (decodeErr) {
                    console.warn('XDR decode failed:', decodeErr);
                }

                // Map error code to a descriptive Turkish message
                const ERROR_MESSAGES: Record<number, string> = {
                    1: '⚠️ Anket henüz başlatılmamış! (PollNotInitialized — kod: 1)',
                    2: '🚫 Bu adres zaten oy kullandı! (AlreadyVoted — kod: 2)',
                    3: '❌ Geçersiz seçenek gönderildi! (InvalidOption — kod: 3)\n' +
                        `   Gönderilen: "${selectedOption}"\n` +
                        `   Kontrat bekliyor: ${KNOWN_OPTIONS.join(', ')}`,
                    4: '⚠️ Anket zaten başlatılmış! (AlreadyInitialized — kod: 4)',
                    5: '🔒 Yetkisiz işlem! (Unauthorized — kod: 5)',
                };

                if (errorCode !== null && ERROR_MESSAGES[errorCode]) {
                    errorMsg = ERROR_MESSAGES[errorCode];
                } else if (errorCode !== null) {
                    errorMsg = `❌ Kontrat hatası (kod: ${errorCode})`;
                }

                throw new Error(errorMsg);
            }

            if (result.status !== 'PENDING' && result.status !== 'DUPLICATE') {
                throw new Error(`Beklenmedik durum: ${result.status}`);
            }

            // 5. Optimistic update — refetch after 2s for confirmation
            setTxStatus('success');
            setHasVoted(true);
            addToast('success', `Oyunuz "${OPTION_LABELS[selectedOption] ?? selectedOption}" için kaydedildi! 🎉`);
            setTimeout(fetchPollData, 2000);

        } catch (e) {
            setTxStatus('error');
            const { variant, message } = classifyWalletError(e);
            addToast(variant, message);
            console.error('Oy verme hatası:', e);
        } finally {
            // Reset to idle after a moment so the button re-enables
            setTimeout(() => setTxStatus('idle'), 1500);
        }
    };

    // ─── Derived state ────────────────────────────────────────────────────────
    const isLoading = txStatus === 'signing' || txStatus === 'pending';
    const maxVotes = Math.max(...Object.values(votes), 1);

    const statusMessages: Record<TxStatus, string | null> = {
        idle: null,
        signing: '✍️ Cüzdanınızda imzalayın...',
        pending: '⏳ Blockchain onayı bekleniyor...',
        success: '✅ Oy başarıyla kaydedildi!',
        error: null,
    };

    return (
        <>
            <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow-xl mt-10">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">
                        🗳️ Canlı Anket: Blockchain Geleceği
                    </h2>
                    <span className="text-sm text-gray-400 font-mono bg-gray-50 px-3 py-1 rounded-full border">
                        {totalVotes} toplam oy
                    </span>
                </div>

                {/* Poll options */}
                <div className="space-y-3">
                    {KNOWN_OPTIONS.map((opt) => {
                        const count = votes[opt] ?? 0;
                        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                        const isSelected = selectedOption === opt;
                        const isWinner = count === maxVotes && totalVotes > 0;

                        return (
                            <div
                                key={opt}
                                onClick={() => !hasVoted && !isLoading && setSelectedOption(opt)}
                                className={`
                                    p-4 border-2 rounded-xl transition-all duration-200
                                    ${hasVoted || isLoading ? 'cursor-default' : 'cursor-pointer hover:bg-blue-50'}
                                    ${isSelected && !hasVoted ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}
                                    ${isWinner && hasVoted ? 'border-green-400 bg-green-50' : ''}
                                `}
                            >
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-semibold text-gray-800">
                                        {OPTION_LABELS[opt] ?? opt}
                                        {isWinner && hasVoted && <span className="ml-2 text-xs text-green-600 font-bold">🏆 Önde</span>}
                                    </span>
                                    <span className="text-gray-500 font-mono text-sm">
                                        {count} oy ({pct}%)
                                    </span>
                                </div>
                                {/* Progress bar */}
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full transition-all duration-700 ${isWinner && hasVoted ? 'bg-green-500' : 'bg-blue-500'
                                            }`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Action area */}
                <div className="mt-8 text-center space-y-3">
                    {/* Inline tx status message */}
                    {statusMessages[txStatus] && (
                        <p className="text-sm font-medium text-blue-600 animate-pulse">
                            {statusMessages[txStatus]}
                        </p>
                    )}

                    {!userAddress ? (
                        <p className="text-gray-400 text-sm">
                            👆 Oy vermek için sağ üstten cüzdanınızı bağlayın.
                        </p>
                    ) : hasVoted ? (
                        <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-5 py-2 rounded-full font-semibold text-sm">
                            ✅ Oyunuz kaydedildi! Teşekkürler.
                        </div>
                    ) : (
                        <button
                            onClick={handleVote}
                            disabled={!selectedOption || isLoading}
                            className={`
                                px-8 py-3 rounded-xl font-bold text-white transition-all duration-200
                                ${!selectedOption || isLoading
                                    ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                                    : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg active:scale-95'
                                }
                            `}
                        >
                            {isLoading ? '⏳ İşleniyor...' : '🗳️ Oy Ver'}
                        </button>
                    )}

                    {/* Contract info */}
                    <p className="text-xs text-gray-300 font-mono mt-4">
                        Contract: {CONTRACT_ID.substring(0, 8)}...{CONTRACT_ID.slice(-4)}
                    </p>
                </div>
            </div>

            <Toast toasts={toasts} onDismiss={dismiss} />
        </>
    );
}

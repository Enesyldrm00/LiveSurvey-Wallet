"use client";

import { useState } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import WalletConnect from '../components/WalletConnect';
import PollUI from '../components/PollUI';

export default function Home() {
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [walletKit, setWalletKit] = useState<StellarWalletsKit | null>(null);

  const handleConnect = (address: string, kit: StellarWalletsKit) => {
    setUserAddress(address);
    setWalletKit(kit);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100">
      <WalletConnect onConnect={handleConnect} />

      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-4">
            Soroban Canlı Anket
          </h1>
          <p className="text-xl text-gray-600">
            Stellar Blockchain üzerinde güvenli, şeffaf ve değiştirilemez oylama.
          </p>
        </header>

        <PollUI userAddress={userAddress} walletKit={walletKit} />

        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p>Yellow Belt Project • Powered by Soroban & Next.js</p>
          <p className="font-mono mt-2 text-xs">Contract: CD53SYMM...BD7K</p>
        </footer>
      </div>
    </main>
  );
}

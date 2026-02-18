# Live Poll — Frontend (Placeholder)

Bu dizin, **StellarWalletsKit** kullanan React/Next.js ön yüz uygulaması için ayrılmıştır.

## Planlanan Teknolojiler

| Teknoloji | Amaç |
|---|---|
| Next.js 14 (App Router) | React framework |
| StellarWalletsKit | Cüzdan bağlantısı (Freighter, xBull, vb.) |
| @stellar/stellar-sdk | Soroban RPC çağrıları |
| TailwindCSS | Stil |

## Planlanan Özellikler

- [ ] Cüzdan bağlantısı (StellarWalletsKit ile)
- [ ] Anket seçeneklerini listeleme
- [ ] Oy verme işlemi (Soroban `vote` fonksiyonu çağrısı)
- [ ] Gerçek zamanlı oy sayısı güncellemesi (Events dinleme)
- [ ] Kullanıcının daha önce oy verip vermediğini kontrol etme

## Kurulum (Sonraki Adımlar)

```bash
npx create-next-app@latest . --typescript --tailwind --app
npm install @creit.tech/stellar-wallets-kit @stellar/stellar-sdk
```

## Soroban Contract Adresi

Kontrat deploy edildikten sonra buraya eklenecek:

```
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NETWORK=testnet
```

# 📚 LEARNING.md — Soroban Canlı Anket Projesi
### Yellow Belt Sertifikasyon Rehberi

> **Güncelleme:** 18 Şubat 2026 — v4.0 (Frontend & Cüzdan Entegrasyonu)

---

## İçindekiler

1. [Proje Genel Bakış](#1-proje-genel-bakış)
2. [Soroban Depolama Sistemi](#2-soroban-depolama-sistemi)
3. [Address ve Symbol Tipleri](#3-address-ve-symbol-tipleri)
4. [Zincir Üstü Veri Maliyeti](#4-zincir-üstü-veri-maliyeti)
5. [Events: Blockchain ile UI Arasındaki Köprü](#5-events-blockchain-ile-ui-arasındaki-köprü)
6. [Güvenlik: require_auth() ve Tek Oy Garantisi](#6-güvenlik-require_auth-ve-tek-oy-garantisi)
7. [Özel Hata Tipleri](#7-özel-hata-tipleri)
8. [Proje Dosya Yapısı](#8-proje-dosya-yapısı)
9. [Bölüm 4: Test Yazmanın Kutsallığı](#9-bölüm-4-test-yazmanın-kutsallığı)
10. [Bölüm 5: Testnet ve Gerçek Dünya](#10-bölüm-5-testnet-ve-gerçek-dünya)
11. [Bölüm 8: Proje Hijyeni ve Cüzdan Köprüsü](#11-bölüm-8-proje-hijyeni-ve-cüzdan-köprüsü)

---

## 1. Proje Genel Bakış

Bu proje, **Stellar Blockchain** üzerinde çalışan bir **Canlı Anket (Live Poll)** uygulamasıdır. Kullanıcılar cüzdanlarını bağlayarak oy verebilir; her oy blockchain'e yazılır ve değiştirilemez.

### Mimari

```
┌─────────────────────────────────────────────────────┐
│                   KULLANICI                         │
│              (Tarayıcı + Cüzdan)                    │
└────────────────────┬────────────────────────────────┘
                     │ İmzalı İşlem
                     ▼
┌─────────────────────────────────────────────────────┐
│              FRONTEND (Next.js)                     │
│         StellarWalletsKit + stellar-sdk             │
│  • Oy gönderme (invoke)                             │
│  • Event dinleme (gerçek zamanlı güncelleme)        │
└────────────────────┬────────────────────────────────┘
                     │ Soroban RPC
                     ▼
┌─────────────────────────────────────────────────────┐
│         SOROBAN SMART CONTRACT (Rust)               │
│  • initialize()  → Anketi başlat                    │
│  • vote()        → Oy ver + Event yayınla           │
│  • get_vote_count() → Oy sayısını oku               │
│  • has_voted()   → Çift oy kontrolü                 │
└─────────────────────────────────────────────────────┘
                     │ Persistent Storage
                     ▼
┌─────────────────────────────────────────────────────┐
│              STELLAR LEDGER                         │
│  (Değiştirilemez, şeffaf, merkeziyetsiz)            │
└─────────────────────────────────────────────────────┘
```

---

## 2. Soroban Depolama Sistemi

Soroban'da üç farklı depolama türü vardır. Doğru türü seçmek hem **güvenlik** hem de **maliyet** açısından kritiktir.

### Depolama Türleri Karşılaştırması

| Tür | Ömür | Maliyet | Kullanım Alanı |
|-----|------|---------|----------------|
| `instance()` | Kontrat yaşadığı sürece | Düşük | Admin adresi, seçenekler listesi |
| `persistent()` | Kira ödendikçe | Orta | Oy sayıları, "oy verdi" kayıtları |
| `temporary()` | Birkaç ledger | Çok düşük | Geçici hesaplamalar, önbellek |

### Projemizde Kullanım

```rust
// Instance Storage — Kontratın ömrü boyunca yaşar
env.storage().instance().set(&DataKey::Admin, &admin);
env.storage().instance().set(&DataKey::Options, &options);

// Persistent Storage — Map<Symbol, u32> ile oy sayım tablosu
// Tüm seçenekler tek bir Map'te tutulur → daha verimli!
let mut tally: Map<Symbol, u32> = Map::new(&env);
tally.set(Symbol::new(&env, "evet"), 0u32);
env.storage().persistent().set(&DataKey::Tally, &tally);

// Map<Address, bool> ile voter takibi
// Her adres için ayrı key yerine tek bir Map → daha temiz!
let mut voters: Map<Address, bool> = Map::new(&env);
voters.set(voter.clone(), true);
env.storage().persistent().set(&DataKey::Voters, &voters);
```

### Neden `persistent()` Kullandık?

Oy sayıları ve voter kayıtları **uzun vadeli** tutulması gereken verilerdir. Eğer `temporary()` kullansaydık, birkaç ledger sonra veriler silinir ve aynı kişi tekrar oy verebilirdi — bu ciddi bir güvenlik açığıdır!

> **💡 Usta Notu (Senior Note)**
>
> Ethereum'da her şey "state" olarak sonsuza kadar saklanır ve bu durum zinciri şişirir (state bloat). Soroban'ın kira modeli bu sorunu çözer: Veri tutmak istiyorsan, bunun maliyetini ödersin. Bu, daha sürdürülebilir bir blockchain tasarımıdır.
>
> Gerçek dünyada bir proje yaparken şunu düşün: "Bu veri 1 yıl sonra hâlâ gerekli mi?" Eğer evet ise `persistent()`, hayır ise `temporary()` kullan. Yanlış seçim ya güvenlik açığı ya da gereksiz maliyet demektir.

---

## 3. Address ve Symbol Tipleri

### `Address` Tipi

`Address`, Soroban'da bir kullanıcı cüzdanını veya başka bir kontratı temsil eder. Önemli özelliği: **`require_auth()` metodunu çağırabilmesidir.**

```rust
pub fn vote(env: Env, voter: Address, option: Symbol) -> Result<u32, PollError> {
    // Bu satır olmadan, herhangi biri başkası adına oy verebilir!
    voter.require_auth();
    // ...
}
```

`require_auth()` şunu garanti eder:
- İşlemi gönderen kişi, `voter` adresinin özel anahtarına sahiptir
- İşlem, bu adres tarafından imzalanmıştır
- Başka biri sahte bir `voter` adresi geçemez

### `Symbol` Tipi

`Symbol`, Soroban'da kısa string değerleri için optimize edilmiş bir tiptir. Maksimum **32 karakter** destekler ve `String`'e göre çok daha verimlidir.

```rust
// Doğru kullanım — kısa ve verimli
symbol_short!("evet")    // Macro ile compile-time oluşturma
Symbol::new(&env, "hayir") // Runtime oluşturma

// Neden String değil Symbol?
// String → Heap allocation, daha pahalı, daha fazla gas
// Symbol → Stack-friendly, optimize edilmiş, daha ucuz
```

Anket seçenekleri için `Symbol` kullanmak mantıklıdır çünkü:
1. Seçenekler genellikle kısa metinlerdir ("evet", "hayir", "belki")
2. Depolama anahtarı olarak kullanılabilir (`DataKey::VoteCount(Symbol)`)
3. Event'lerde verimli şekilde taşınır

> **💡 Usta Notu (Senior Note)**
>
> İlk Soroban projemde her şey için `String` kullandım. Deploy ettikten sonra gas maliyetlerinin neden bu kadar yüksek olduğunu anlayamadım. Sonra fark ettim: Blockchain'de her byte para demektir. `Symbol` kullanmak, özellikle depolama anahtarlarında, maliyeti ciddi oranda düşürür.
>
> Kural basit: 32 karakterden kısa, sabit değerler için → `Symbol`. Kullanıcı girişi veya dinamik uzun metinler için → `Bytes` veya `String`.

---

## 4. Zincir Üstü Veri Maliyeti

Blockchain'de veri saklamak **ücretsiz değildir**. Soroban, her depolama işlemi için **XLM** cinsinden ücret alır.

### Maliyet Bileşenleri

```
İşlem Maliyeti = İşlem Ücreti + Depolama Kirası

İşlem Ücreti:
  • CPU talimatları (instructions)
  • Bellek kullanımı (memory bytes)
  • Ağ verisi (network bandwidth)

Depolama Kirası (Persistent için):
  • Veri boyutu × Kira oranı × Süre
  • Kira ödenmezse veri arşivlenir (silinmez, ama erişilemez)
```

### Projemizde Optimizasyon Kararları

| Karar | Neden? |
|-------|--------|
| `Symbol` kullan, `String` değil | Daha az byte = daha az maliyet |
| `HasVoted` için sadece `bool` sakla | Tam adresi tekrar saklamak gereksiz |
| `Options` listesini `instance()`'da tut | Sık okunan veri, düşük erişim maliyeti |
| `VoteCount` için `u32` kullan | `u64` gereksiz, anket için 4 milyar oy yeterli |

### Kira Modeli Nasıl Çalışır?

```
Ledger 1000: Veri yazıldı, kira ödendi (1000 ledger için)
Ledger 2000: Kira süresi doldu → Veri "arşivlendi"
Ledger 2001: Veriyi okumaya çalışırsın → HATA!

Çözüm: extend_ttl() ile kira süresini uzat
env.storage().persistent().extend_ttl(&key, min_ledger, max_ledger);
```

> **💡 Usta Notu (Senior Note)**
>
> Bir müşteri için oy sistemi geliştirirken, 6 ay sonra kullanıcılar "oy sayıları sıfırlandı" diye şikayet etmeye başladı. Sorun şuydu: Persistent storage'ın kirasını uzatmayı unutmuştuk. Veriler arşivlenmişti.
>
> Üretim projelerinde her zaman bir "kira yönetimi" stratejisi belirle. Önemli veriler için `extend_ttl()` çağrısını işlem akışına dahil et veya ayrı bir "bakım" fonksiyonu yaz.

---

## 5. Events: Blockchain ile UI Arasındaki Köprü

Events (Olaylar), Soroban kontratlarının dış dünyayla iletişim kurmasının en verimli yoludur. **Depolanmazlar** — sadece işlem kaydında yer alırlar ve çok ucuzdurlar.

### Neden Events Kritik?

```
Senaryo: Kullanıcı A oy verdi. Kullanıcı B'nin ekranı nasıl güncellenecek?

❌ Kötü Yöntem: Her 5 saniyede bir blockchain'i sorgula (polling)
   → Gereksiz RPC çağrıları, gecikme, yüksek maliyet

✅ İyi Yöntem: Event'leri dinle, değişiklik olunca güncelle
   → Anlık güncelleme, düşük maliyet, gerçek "canlı" deneyim
```

### Kontratımızdaki Event

```rust
// vote() fonksiyonunun içinde, başarılı oylamadan sonra:
env.events().publish(
    // Topics: Event'i kategorize etmek için kullanılır
    // Frontend bu topics'e göre filtre yapabilir
    (symbol_short!("poll"), symbol_short!("voted"), option.clone()),
    
    // Data: Event ile taşınan veri
    new_count,  // Yeni toplam oy sayısı
);
```

### Frontend'de Event Dinleme (Gelecek Adım)

```typescript
// stellar-sdk ile event dinleme (Next.js frontend'de)
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// İşlem sonrası event'leri oku
const txResult = await server.getTransaction(txHash);
const events = txResult.resultMetaXdr.v3().sorobanMeta().events();

// Her event'i işle
events.forEach(event => {
    const topics = event.body().v0().topics();
    const data = event.body().v0().data();
    
    if (topics[1].value() === "voted") {
        const option = topics[2].value();
        const newCount = data.value();
        updateUI(option, newCount); // Ekranı güncelle!
    }
});
```

### Event vs Depolama Karşılaştırması

| Özellik | Event | Storage |
|---------|-------|---------|
| Maliyet | Çok düşük | Orta-yüksek |
| Kalıcılık | Sadece işlem kaydında | Ledger'da kalıcı |
| Okunabilirlik | Horizon API ile | RPC ile |
| Gerçek zamanlı | ✅ Evet | ❌ Polling gerekir |
| Tarihsel sorgu | ✅ Evet | ❌ Sadece güncel değer |

> **💡 Usta Notu (Senior Note)**
>
> Events, Ethereum'daki `emit` ile aynı konsepttir ama Soroban'da çok daha yapılandırılmıştır. İlk projemde event kullanmadım ve frontend için her saniye blockchain'i sorgulamak zorunda kaldım. Sunucu maliyetleri çıldırdı.
>
> Altın kural: **Kullanıcıya göstermek istediğin her değişiklik için bir event yayınla.** Depolama okuma işlemleri pahalıdır; event'ler ise neredeyse bedavadır. Frontend geliştiricileri seni sevecek!

---

## 6. Güvenlik: require_auth() ve Tek Oy Garantisi

### require_auth() Mekanizması

```rust
pub fn vote(env: Env, voter: Address, option: Symbol) -> Result<u32, PollError> {
    voter.require_auth(); // ← Bu satır HER ŞEYİ değiştirir
    // ...
}
```

`require_auth()` olmadan ne olur?

```
Saldırgan: "Ben voter=GABC...XYZ adına oy veriyorum"
Kontrat: "Tamam, oy kaydedildi" ← FELAKET!

require_auth() ile:
Saldırgan: "Ben voter=GABC...XYZ adına oy veriyorum"
Kontrat: "Bu adresin imzası yok, işlem reddedildi" ← DOĞRU!
```

### Çift Oy Önleme

```rust
// Oy vermeden önce kontrol
if env.storage().persistent().has(&DataKey::HasVoted(voter.clone())) {
    return Err(PollError::AlreadyVoted);
}

// Oy verdikten sonra kaydet
env.storage()
    .persistent()
    .set(&DataKey::HasVoted(voter.clone()), &true);
```

Bu iki satır birlikte, **Sybil saldırılarına** karşı temel koruma sağlar. Her Stellar adresi için ayrı kayıt tutulur.

> **💡 Usta Notu (Senior Note)**
>
> `require_auth()` Soroban'ın en güçlü özelliklerinden biridir. Ethereum'da `msg.sender` ile kimin çağırdığını anlarsın ama imzayı doğrulamak için ekstra iş yapman gerekir. Soroban'da `require_auth()` tek satırla hem "kim çağırdı" hem de "gerçekten o mu imzaladı" sorularını yanıtlar.
>
> Bir kez bir kontrat gördüm: `require_auth()` yoktu ve herkes admin fonksiyonlarını çağırabiliyordu. 50.000 dolarlık bir proje, 2 saatte boşaltıldı. Bu satırı asla atlama!

---

## 7. Özel Hata Tipleri

```rust
#[contracterror]
#[repr(u32)]
pub enum PollError {
    PollNotInitialized = 1,
    AlreadyVoted       = 2,
    InvalidOption      = 3,
    AlreadyInitialized = 4,
    Unauthorized       = 5,
}
```

### Neden Özel Hatalar?

1. **Frontend anlamlı mesaj gösterebilir**: `2` → "Zaten oy kullandınız!"
2. **Debugging kolaylaşır**: Hata kodundan sorunu hemen anlarsın
3. **Kontrat arayüzü netleşir**: Hangi durumların hata ürettiği belgelenmiş olur

### Frontend'de Hata Yönetimi (Gelecek Adım)

```typescript
try {
    await pollContract.vote({ voter: address, option: "evet" });
} catch (error) {
    if (error.code === 2) {
        showToast("Zaten oy kullandınız! Her adres yalnızca bir kez oy verebilir.");
    } else if (error.code === 3) {
        showToast("Geçersiz seçenek. Lütfen listeden bir seçenek seçin.");
    }
}
```

> **💡 Usta Notu (Senior Note)**
>
> Hata kodlarını `1`'den başlatmak bir konvansiyondur. `0` genellikle "hata yok" anlamına gelir. Ayrıca hata kodlarını dokümante et — 6 ay sonra `error.code === 4` ne anlama geliyordu diye düşünmek istemezsin!

---

## 8. Proje Dosya Yapısı

```
CanlıAnket-Wallet/
├── contracts/
│   └── poll/
│       ├── Cargo.toml          ← Rust bağımlılıkları
│       └── src/
│           ├── lib.rs          ← Ana kontrat kodu (Map tabanlı)
│           └── test.rs         ← 6 test senaryosu
│
├── frontend/
│   └── README.md               ← Next.js placeholder
│
└── LEARNING.md                 ← Bu dosya!
```

### Sonraki Adımlar

- [x] **Kontratı yaz**: `lib.rs` (Map tabanlı, event'li)
- [x] **Test suite oluştur**: `test.rs` (6 test senaryosu)
- [ ] **Testleri çalıştır**: `cargo test --manifest-path contracts/poll/Cargo.toml`
- [ ] **Testnet'e deploy et**: `stellar contract deploy`
- [ ] **Frontend'i başlat**: Next.js + StellarWalletsKit kurulumu
- [ ] **Event dinlemeyi implement et**: Gerçek zamanlı UI güncellemesi

---

## 9. Bölüm 4: Test Yazmanın Kutsallığı

> *"Blockchain'de deploy etmek, bir mektubu posta kutusuna atmak gibidir — geri alamazsın."*

Web2'de bir bug bulduğunda sunucuyu yeniden başlatırsın, kodu düzeltirsin, deploy edersin. Web3'te ise bir kez deploy ettiğin kontrat **sonsuza kadar o haliyle zincirde kalır**. Bu yüzden test yazmak bir tercih değil, **zorunluluktur**.

---

### Contract Client Nedir?

Soroban test ortamında `#[contractimpl]` makrosu otomatik olarak bir **istemci (client)** sınıfı üretir. Bu istemci, kontrat fonksiyonlarını sanki gerçek bir blockchain çağrısıymış gibi test ortamında çağırmana izin verir.

```rust
// Kontratı sanal ortama kaydet
let contract_id = env.register_contract(None, PollContract);

// Otomatik üretilen istemciyi oluştur
// PollContractClient → #[contractimpl] tarafından üretildi
let client = PollContractClient::new(&env, &contract_id);

// Artık kontrat fonksiyonlarını doğrudan çağırabilirsin:
client.initialize(&admin, &options);  // → Result<(), PollError>
client.vote(&voter, &option);         // → Result<u32, PollError>

// Hata beklediğin durumlarda try_ prefix'ini kullan:
let result = client.try_vote(&voter, &option); // → Result<Result<u32, PollError>, ...>
assert!(result.is_err());
```

**`try_` prefix'i neden önemli?**

Normal `client.vote()` çağrısı hata durumunda **panic** yapar ve testi çökertir. `try_vote()` ise hatayı `Result` olarak döndürür, böylece hata senaryolarını güvenle test edebilirsin.

---

### `env.mock_all_auths()` Neden Kullanırız?

Gerçek bir blockchain işleminde `require_auth()`, işlemin o adresin özel anahtarıyla imzalanmış olmasını zorunlu kılar. Test ortamında ise gerçek bir cüzdan yoktur.

```rust
fn setup_env() -> (Env, PollContractClient<'static>, Address) {
    let env = Env::default();
    
    // Bu satır olmadan tüm require_auth() çağrıları panic yapar!
    env.mock_all_auths();
    // ↑ "Bu testte tüm yetkilendirme kontrollerini otomatik onayla"
    // ↑ Gerçek imza simülasyonu gerekmez
    
    let contract_id = env.register_contract(None, PollContract);
    let client = PollContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env); // Rastgele test adresi
    
    (env, client, admin)
}
```

**`mock_all_auths()` vs `mock_auths()`:**

| Yöntem | Kullanım |
|--------|----------|
| `mock_all_auths()` | Tüm auth çağrılarını otomatik onayla (hızlı test) |
| `mock_auths(&[...])` | Belirli auth çağrılarını kontrol et (hassas test) |

Üretim kalitesinde testler için `mock_auths()` ile hangi adresin hangi fonksiyonu çağırdığını da doğrulayabilirsin.

---

### Projemizdeki 6 Test Senaryosu

| Test | Amaç | Beklenen Sonuç |
|------|------|----------------|
| `test_successful_initialization_and_voting` | Happy path | Oylar doğru birikir |
| `test_double_voting_returns_already_voted_error` | Çift oy | `AlreadyVoted` hatası |
| `test_invalid_option_returns_error` | Geçersiz seçenek | `InvalidOption` hatası |
| `test_vote_emits_correct_event` | Event doğrulama | Topics ve data eşleşir |
| `test_vote_on_uninitialized_poll` | Başlatılmamış anket | `PollNotInitialized` hatası |
| `test_double_initialization_returns_error` | Tekrar başlatma | `AlreadyInitialized` hatası |

### Event Testi Nasıl Çalışır?

```rust
#[test]
fn test_vote_emits_correct_event() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    let voter = Address::generate(&env);
    let option = Symbol::new(&env, "evet");
    client.vote(&voter, &option);

    // env.events().all() → işlem sırasında yayınlanan tüm event'ler
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let event = events.get(0).unwrap();
    // event = (contract_id, topics, data)

    // Topics: ("poll", "voted") → XDR Val olarak karşılaştır
    let expected_topics = (symbol_short!("poll"), symbol_short!("voted")).into_val(&env);
    assert_eq!(event.1, expected_topics);

    // Data: (voter, option, new_count=1)
    let expected_data = (voter, option, 1u32).into_val(&env);
    assert_eq!(event.2, expected_data);
}
```

---

> **💡 Usta Notu (Senior Note) — Web3'te Test Yazmanın Farkı**
>
> Web2'de bir bug bulduğunda şunu yaparsın: hotfix → deploy → bitti. Kullanıcı birkaç dakika etkilenir.
>
> Web3'te ise hikaye çok farklıdır:
>
> 1. **Değiştirilemezlik (Immutability)**: Deploy ettiğin kontrat zincirde sonsuza kadar kalır. Yanlış bir mantık, milyonlarca dolarlık varlığı kilitleyebilir. 2016'daki DAO hack'ini hatırla — 60 milyon dolar, tek bir re-entrancy bug'ı yüzünden çalındı.
>
> 2. **Gas maliyeti**: Her test senaryosunu production'da çalıştırmak para harcar. Test ortamında ücretsiz olarak keşfettiğin her bug, gerçek dünyada tasarruf demektir.
>
> 3. **Kullanıcı güveni**: Blockchain uygulamalarında kullanıcılar kodun doğruluğuna güvenir. Audit raporları ve test coverage'ı, projenin ciddiyetini gösterir.
>
> **Altın kural**: Her public fonksiyon için en az 3 test yaz — happy path, hata senaryosu, ve edge case. Testlerin olmadığı bir Soroban kontratı, imzasız bir çek gibidir.

---

## 10. Bölüm 5: Testnet ve Gerçek Dünya

> *"Testnet, blockchain dünyasının kum havuzudur. Orada yıkılan her şey, gerçek para kaybetmeden öğrenilmiş bir derstir."*

---

### .wasm Dosyası Nedir?

Soroban kontratları Rust ile yazılır, ancak blockchain **Rust kodunu doğrudan çalıştıramaz**. Bunun yerine Rust kodu, **WebAssembly (WASM)** formatına derlenir.

```
Rust Kodu (.rs)
    │
    │  cargo build --target wasm32v1-none --release
    ▼
WASM Binary (.wasm)   ← Blockchain'in anladığı dil
    │
    │  stellar contract deploy
    ▼
Stellar Ledger        ← Sonsuza kadar zincirde
```

**WASM'in avantajları:**
- Dil bağımsız: Rust, C++, Go ile yazılabilir
- Sandbox: Güvenli izole çalışma ortamı
- Deterministik: Her düğümde aynı sonuç
- Küçük boyut: `opt-level = "z"` ile optimize edilir

**Projemizdeki WASM:**
```
contracts/poll/target/wasm32v1-none/release/soroban_poll_contract.wasm
```

---

### Contract ID Nedir?

Kontrat deploy edildiğinde, Stellar ona benzersiz bir **Contract ID** atar. Bu ID, kontratı tanımlayan 56 karakterlik bir string'dir.

```
Contract ID (Projemiz):
CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K

Stellar Lab Explorer:
https://lab.stellar.org/r/testnet/contract/CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K
```

**Contract ID nasıl oluşturulur?**
```
Contract ID = Hash(deployer_address + sequence_number)
```
Yani aynı WASM'i farklı hesaplardan deploy edersen, farklı Contract ID'ler alırsın.

**Frontend'de kullanım:**
```typescript
const CONTRACT_ID = "CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K";
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
```

---

### Friendbot Neden Gerekli?

Testnet'te her işlem için **XLM** gerekir (gas ücreti). Gerçek XLM almak için borsa kullanman gerekir. Testnet için ise **Friendbot** adlı bir musluk (faucet) vardır.

```
Friendbot → Testnet hesabına ücretsiz 10.000 XLM gönderir
Mainnet'te bu yoktur — gerçek XLM satın alınmalıdır
```

**Friendbot URL:**
```
https://friendbot.stellar.org/?addr=<ADRES>
```

---

### Tam Deployment Akışı (Gerçek Komutlar)

Aşağıdaki komutlar bu proje için gerçekten çalıştırıldı ve başarılı oldu.

#### Adım 1: Kontratı Derle

```bash
# stellar contract build, cargo build'in Soroban-optimize edilmiş versiyonudur
# Otomatik olarak wasm32v1-none hedefini kullanır
stellar contract build --manifest-path contracts/poll/Cargo.toml

# Çıktı:
# ✓ Build Complete
# contracts/poll/target/wasm32v1-none/release/soroban_poll_contract.wasm
```

#### Adım 2: Kimlik Oluştur

```bash
# Yeni bir anahtar çifti oluştur ve 'poll_admin' takma adıyla kaydet
stellar keys generate poll_admin --network testnet

# Public adresi gör
stellar keys address poll_admin
# Çıktı: GC4ED7N5WUGI4ZGJMT4ADDRWKVHXLYSQN5VJBWMTOFIL6YEVLJLJKEWY
```

#### Adım 3: Friendbot ile Fonla

```bash
# Yöntem 1: Stellar CLI (ağ bağlantısı gerektiriyor)
stellar keys fund poll_admin --network testnet

# Yöntem 2: Doğrudan HTTP (her zaman çalışır)
curl "https://friendbot.stellar.org/?addr=$(stellar keys address poll_admin)"

# Başarılı yanıt:
# { "successful": true, "hash": "04cae446..." }
```

#### Adım 4: Deploy Et

```bash
stellar contract deploy \
  --wasm contracts/poll/target/wasm32v1-none/release/soroban_poll_contract.wasm \
  --source poll_admin \
  --network testnet

# Çıktı:
# ✓ Deployed!
# CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K
#
# Explorer:
# https://lab.stellar.org/r/testnet/contract/CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K
```

#### Adım 5: Anketi Başlat (initialize)

```bash
# options.json dosyası oluştur (BOM olmadan!)
echo '[ "AI_AGI", "Web3_Soroban", "DeFi_Future", "NFT_Metaverse" ]' > options.json

# initialize fonksiyonunu çağır
stellar contract invoke \
  --id CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K \
  --source poll_admin \
  --network testnet \
  -- initialize \
  --admin GC4ED7N5WUGI4ZGJMT4ADDRWKVHXLYSQN5VJBWMTOFIL6YEVLJLJKEWY \
  --options-file-path options.json

# Başarılı çıktı: null
# (Result<(), PollError> başarısı = null)
```

#### Adım 6: Oy Sayısını Kontrol Et (Read-only)

```bash
stellar contract invoke \
  --id CD53SYMMTIQNZZYPYCXMER67BGLNRGKI46JXFFHFWESW7E3NJUP6BD7K \
  --source poll_admin \
  --network testnet \
  -- get_vote_count \
  --option AI_AGI

# Çıktı: 0
```

---

> **💡 Usta Notu (Senior Note) — Secret Key Güvenliği: "Not Your Keys, Not Your Coins"**
>
> Bu projede `poll_admin` kimliği oluşturduğunda, Stellar CLI senin için bir **özel anahtar (secret key)** üretti ve bunu yerel dosya sisteminde sakladı.
>
> **Özel anahtar nerede saklanır?**
> ```
> Windows: C:\Users\<kullanıcı>\.config\stellar\identity\poll_admin.toml
> Linux/Mac: ~/.config/stellar/identity/poll_admin.toml
> ```
>
> **Bu dosyayı asla:**
> - Git'e commit etme (`.gitignore`'a ekle!)
> - Başkasıyla paylaşma
> - Ekran görüntüsü alma
> - Bulut depolama hizmetlerine yükleme
>
> **"Not your keys, not your coins" prensibi:**
> Blockchain'de hesabını kontrol eden kişi, özel anahtarına sahip olan kişidir. Banka gibi "şifremi unuttum" diyemezsin. Özel anahtar kaybolursa, o hesaptaki tüm varlıklar sonsuza kadar erişilemez hale gelir.
>
> **Mainnet için altın kurallar:**
> 1. Özel anahtarları **donanım cüzdanı** (Ledger, Trezor) ile sakla
> 2. Seed phrase'i kağıda yaz, çevrimdışı sakla
> 3. Testnet ve mainnet anahtarlarını **kesinlikle karıştırma**
> 4. CI/CD pipeline'larda çevre değişkenleri kullan, dosya değil
>
> 2022'de bir geliştirici, testnet özel anahtarını yanlışlıkla GitHub'a commit etti. Aynı anahtar mainnet'te de kullanılıyordu. 3 dakika içinde bir bot hesabı boşalttı — 140.000 dolar.

---

*Bu dosya, her kod güncellemesinde otomatik olarak güncellenmektedir.*
*Soroban Dokümantasyonu: https://developers.stellar.org/docs/build/smart-contracts*

---

## 11. Bölüm 8: Proje Hijyeni ve Cüzdan Köprüsü

> *"Temiz bir repo, temiz bir zihin demektir. Blockchain'de güven, kodun kalitesiyle başlar."*

---

### Proje Hijyeni: `.gitignore` ve Git Cache Temizliği

#### Neden `.gitignore` Bu Kadar Önemli?

GitHub'ın "secret detected" uyarısı aldığında, genellikle iki şeyden biri olmuştur:

1. Bir `.env` dosyası veya özel anahtar içeren dosya commit'e dahil edilmiştir
2. Bir binary dosya (`.pdb`, `.exe`) içinde gömülü bir string, secret scanner tarafından yanlış pozitif olarak işaretlenmiştir

Her iki durumda da çözüm aynıdır: **Dosyayı git geçmişinden tamamen çıkar.**

#### Mevcut Build Artifact'larını Git'ten Silme

Bir dosyayı `.gitignore`'a eklemek, **zaten takip edilen** dosyaları otomatik olarak silmez. Git cache'ini temizlemek için şu komutları çalıştır:

```bash
# Rust build artifact'larını git takibinden çıkar (dosyaları silmez!)
git rm -r --cached contracts/poll/target/

# Node.js bağımlılıklarını çıkar
git rm -r --cached frontend/node_modules/

# Next.js build çıktısını çıkar
git rm -r --cached frontend/.next/

# TypeScript build bilgisini çıkar
git rm --cached frontend/tsconfig.tsbuildinfo

# Değişiklikleri commit et ve GitHub'a gönder
git add .gitignore
git commit -m "chore: remove build artifacts from git tracking"
git push
```

> **⚠️ Önemli:** `git rm --cached` komutu dosyaları **diskten silmez**, sadece git'in takibinden çıkarır. Güvende!

#### ENOENT Hatası: Neden `npm run dev` Root'ta Çalışmaz?

```
Error: ENOENT: no such file or directory, open '.../package.json'
```

Bu hata, `npm`'in `package.json` dosyasını **mevcut dizinde** aradığı için oluşur. Projemizin root dizininde (`CanlıAnket-Wallet/`) `package.json` yoktur — sadece `frontend/` klasöründe vardır.

```
CanlıAnket-Wallet/          ← Burada package.json YOK → ENOENT!
├── contracts/
├── frontend/
│   └── package.json        ← package.json BURADA
└── .gitignore
```

**Doğru komutlar:**

```bash
# Yöntem 1: Önce dizine gir (önerilen)
cd frontend
npm run dev

# Yöntem 2: --prefix ile root'tan çalıştır
npm run dev --prefix frontend
```

---

### Provider Pattern: Web3'ün Temel Tasarım Deseni

#### Provider Nedir?

Web3'te **Provider**, uygulamanın blockchain ile konuşmasını sağlayan köprüdür. Bunu bir elektrik prizi gibi düşün:

```
Gerçek Dünya Analojisi:
┌─────────────────────────────────────────────────────┐
│  Elektrikli Alet (Uygulama)                         │
│       │                                             │
│       ▼                                             │
│  Priz (Provider / WalletKit)                        │
│       │                                             │
│       ▼                                             │
│  Elektrik Şebekesi (Blockchain)                     │
└─────────────────────────────────────────────────────┘
```

Alet (uygulama), şebekenin (blockchain) nasıl çalıştığını bilmek zorunda değildir. Sadece prize (provider) takılır ve çalışır.

#### Web3'teki Provider Hiyerarşisi

```typescript
// Seviye 1: Ham RPC Provider — Blockchain ile doğrudan konuşur
const server = new rpc.Server("https://soroban-testnet.stellar.org");

// Seviye 2: Wallet Provider — İmzalama yetkisini yönetir
// (Freighter, Albedo, xBull — her biri farklı bir "priz" tipi)

// Seviye 3: WalletKit — Tüm "priz tiplerini" tek arayüzde toplar
const kit = new StellarWalletsKit({ modules: allowAllModules() });
```

---

### Neden Tek Cüzdan Yerine WalletKit?

#### Tek Cüzdan Yaklaşımının Sorunları

```typescript
// ❌ Kötü yaklaşım: Sadece Freighter destekle
import { isConnected, getPublicKey } from "@stellar/freighter-api";

// Sorunlar:
// 1. Freighter yüklü değilse uygulama çalışmaz
// 2. Mobil kullanıcılar dışlanır (Freighter sadece masaüstü)
// 3. Her yeni cüzdan için kod değiştirmek gerekir
// 4. Test etmek için gerçek cüzdan gerekir
```

#### WalletKit Yaklaşımının Avantajları

```typescript
// ✅ İyi yaklaşım: WalletKit ile tüm cüzdanları destekle
const kit = new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    modules: allowAllModules(), // Freighter, Albedo, xBull, Lobstr, vb.
});

// Avantajlar:
// 1. Kullanıcı kendi tercih ettiği cüzdanı seçer
// 2. Yeni cüzdan desteği → sadece modül ekle, kod değiştirme
// 3. Tek bir API: kit.getAddress(), kit.signTransaction()
// 4. Modal UI otomatik gelir — sen tasarlamak zorunda değilsin
```

#### Desteklenen Cüzdanlar ve Kullanım Alanları

| Cüzdan | Tip | Kullanım Alanı |
|--------|-----|----------------|
| **Freighter** | Tarayıcı Eklentisi | Masaüstü geliştirici/kullanıcı |
| **Albedo** | Web Tabanlı | Eklenti yüklemek istemeyenler |
| **xBull** | Tarayıcı Eklentisi | Gelişmiş DeFi kullanıcıları |
| **Lobstr** | Mobil + Web | Mobil kullanıcılar |
| **WalletConnect** | Protokol | Mobil cüzdan köprüsü |

```typescript
// Projemizdeki WalletKit konfigürasyonu
const kit = new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    selectedWalletId: 'freighter',  // Varsayılan seçim
    modules: allowAllModules(),      // Tüm modülleri yükle
});

// Kullanıcı cüzdan seçtiğinde:
kit.setWallet(option.id);           // Seçilen cüzdana geç
const { address } = await kit.getAddress();  // Adresi al
```

---

### Hata Yönetimi: 3 Kritik Senaryo

Web3 uygulamalarında en sık karşılaşılan 3 hata tipi ve nasıl ele alınacağı:

#### 1. Cüzdan Bulunamadı (Wallet Not Found)

```typescript
// Kullanıcı Freighter yüklememiş
// Hata mesajı: "not installed", "not found", "undefined"

// ❌ Kötü UX:
throw new Error("Wallet not found");  // Kullanıcı ne yapacağını bilmez!

// ✅ İyi UX:
addToast('error', 'Cüzdan bulunamadı. Freighter eklentisini yükleyin: freighter.app');
```

#### 2. Kullanıcı Reddetti (User Rejected)

```typescript
// Kullanıcı cüzdan popup'ını kapattı veya "Reddet" tıkladı
// Hata mesajı: "rejected", "cancelled", "denied"

// ❌ Kötü UX:
alert("Transaction failed!");  // Kullanıcıyı suçlar gibi

// ✅ İyi UX:
addToast('warning', 'Bağlantı reddedildi. Cüzdanınızdan onay verin.');
// Uyarı tonu kullan, hata değil — kullanıcı bilinçli karar verdi
```

#### 3. Yetersiz Bakiye (Insufficient Balance)

```typescript
// Kullanıcının XLM bakiyesi işlem ücretini karşılamıyor
// Hata mesajı: "insufficient", "balance", "underfunded"

// ✅ İyi UX:
addToast('error', "Yetersiz bakiye. Friendbot'tan test XLM alın: friendbot.stellar.org");
// Çözümü de söyle!
```

---

> **💡 Usta Notu (Senior Note) — Web3'te Kullanıcı Deneyimi: "Uygulama Dondu mu?"**
>
> Blockchain işlemleri **yavaştır**. Stellar Testnet'te bir işlem 5-10 saniye sürebilir. Mainnet'te bu süre değişkendir. Bu süre zarfında kullanıcı ne düşünür?
>
> *"Uygulama dondu mu? Butona tekrar tıklasam mı? İşlem gitti mi gitmedi mi?"*
>
> Bu belirsizlik, Web3'ün en büyük UX sorunlarından biridir. Çözüm: **İşlem durumunu her adımda kullanıcıya göster.**
>
> ```
> Kullanıcı "Oy Ver" tıklar
>     │
>     ▼
> [✍️ Cüzdanınızda imzalayın...]  ← txStatus: 'signing'
>     │
>     ▼ (Kullanıcı imzaladı)
> [⏳ Blockchain onayı bekleniyor...]  ← txStatus: 'pending'
>     │
>     ▼ (5-10 saniye)
> [✅ Oy başarıyla kaydedildi!]  ← txStatus: 'success'
> ```
>
> **Teknik çözümler:**
>
> 1. **Optimistic UI**: İşlem onaylanmadan önce UI'ı güncelle, hata olursa geri al. Kullanıcı anında geri bildirim alır.
>
> 2. **Durum Makinesi (State Machine)**: `idle → signing → pending → success/error` gibi açık durumlar tanımla. Her durumda farklı UI göster.
>
> 3. **Polling Stratejisi**: İşlem gönderildikten sonra her 2 saniyede bir `getTransaction()` ile durumu kontrol et. Onaylandığında UI'ı güncelle.
>
> 4. **Buton Kilitleme**: İşlem süresince butonu devre dışı bırak. Kullanıcı çift tıklayarak iki işlem gönderemez.
>
> ```typescript
> // Projemizdeki state machine örneği:
> type TxStatus = 'idle' | 'signing' | 'pending' | 'success' | 'error';
>
> // Her durum için farklı mesaj:
> const statusMessages = {
>     signing: '✍️ Cüzdanınızda imzalayın...',
>     pending: '⏳ Blockchain onayı bekleniyor...',
>     success: '✅ Oy başarıyla kaydedildi!',
> };
> ```
>
> **Altın kural**: Kullanıcı hiçbir zaman "ne oluyor?" diye merak etmemeli. Her blockchain işlemi için en az 3 durum göster: başladı, devam ediyor, bitti.

---

*Bu dosya, her kod güncellemesinde otomatik olarak güncellenmektedir.*
*Soroban Dokümantasyonu: https://developers.stellar.org/docs/build/smart-contracts*


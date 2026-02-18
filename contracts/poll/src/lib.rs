#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    symbol_short,
    Address, Env, Map, Symbol, Vec,
};

// ============================================================
// STORAGE KEYS
// ============================================================
/// Kontratın tüm depolama anahtarları.
/// `#[contracttype]` ile XDR serileştirmesi otomatik sağlanır.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Anket yöneticisinin adresi (Instance storage)
    Admin,
    /// Geçerli seçenekler listesi — Vec<Symbol> (Instance storage)
    Options,
    /// Anketin başlatılıp başlatılmadığı (Instance storage)
    Initialized,
    /// Oy sayım tablosu: Map<Symbol, u32> (Persistent storage)
    Tally,
    /// Oy kullananlar: Map<Address, bool> (Persistent storage)
    Voters,
}

// ============================================================
// CUSTOM ERRORS
// ============================================================
/// Kontrat hata kodları. u32 olarak kodlanır ve istemciye iletilir.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PollError {
    /// Anket henüz başlatılmamış
    PollNotInitialized = 1,
    /// Bu adres daha önce oy kullandı
    AlreadyVoted = 2,
    /// Geçersiz seçenek — listede yok
    InvalidOption = 3,
    /// Anket zaten başlatılmış
    AlreadyInitialized = 4,
    /// Yalnızca admin bu işlemi yapabilir
    Unauthorized = 5,
}

// ============================================================
// CONTRACT
// ============================================================
#[contract]
pub struct PollContract;

#[contractimpl]
impl PollContract {

    // ----------------------------------------------------------
    // INITIALIZE
    // ----------------------------------------------------------
    /// Anketi başlatır. Yalnızca bir kez çağrılabilir.
    ///
    /// # Parametreler
    /// - `admin`: Anketi yöneten adres (auth gerektirir)
    /// - `options`: Geçerli oy seçenekleri listesi (Vec<Symbol>)
    pub fn initialize(
        env: Env,
        admin: Address,
        options: Vec<Symbol>,
    ) -> Result<(), PollError> {
        // Zaten başlatılmışsa hata döndür
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::AlreadyInitialized);
        }

        // Admin imzasını doğrula
        admin.require_auth();

        // Admin ve seçenekleri instance storage'a yaz
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Options, &options);

        // Tally map'ini başlat: her seçenek için 0
        let mut tally: Map<Symbol, u32> = Map::new(&env);
        for option in options.iter() {
            tally.set(option.clone(), 0u32);
        }
        env.storage().persistent().set(&DataKey::Tally, &tally);

        // Voters map'ini başlat (boş)
        let voters: Map<Address, bool> = Map::new(&env);
        env.storage().persistent().set(&DataKey::Voters, &voters);

        // Başlatıldı olarak işaretle
        env.storage().instance().set(&DataKey::Initialized, &true);

        Ok(())
    }

    // ----------------------------------------------------------
    // VOTE
    // ----------------------------------------------------------
    /// Bir kullanıcının oy vermesini sağlar.
    ///
    /// # Güvenlik
    /// - `voter.require_auth()` ile imza doğrulaması yapılır
    /// - `Map<Address, bool>` ile çift oy önlenir
    /// - Yalnızca geçerli seçeneklere oy verilebilir
    ///
    /// # Event
    /// `("poll", "voted")` → data: `(voter, option, new_count)`
    pub fn vote(
        env: Env,
        voter: Address,
        option: Symbol,
    ) -> Result<u32, PollError> {
        // 1. Anketin başlatılıp başlatılmadığını kontrol et
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::PollNotInitialized);
        }

        // 2. Voter'ın bu işlemi imzaladığını doğrula
        voter.require_auth();

        // 3. Voters map'ini yükle ve çift oy kontrolü yap
        let mut voters: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&DataKey::Voters)
            .unwrap();

        if voters.contains_key(voter.clone()) {
            return Err(PollError::AlreadyVoted);
        }

        // 4. Tally map'ini yükle ve seçeneğin geçerliliğini kontrol et
        let mut tally: Map<Symbol, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Tally)
            .unwrap();

        if !tally.contains_key(option.clone()) {
            return Err(PollError::InvalidOption);
        }

        // 5. Oy sayısını artır
        let current = tally.get(option.clone()).unwrap();
        let new_count = current + 1;
        tally.set(option.clone(), new_count);

        // 6. Voter'ı kaydet
        voters.set(voter.clone(), true);

        // 7. Güncellenmiş map'leri persistent storage'a geri yaz
        env.storage().persistent().set(&DataKey::Tally, &tally);
        env.storage().persistent().set(&DataKey::Voters, &voters);

        // 8. EVENT YAYINLA
        // Topics: ("poll", "voted")
        // Data:   (voter_address, selected_option, new_total_count)
        // Frontend bu event'i dinleyerek anlık güncelleme yapabilir.
        env.events().publish(
            (symbol_short!("poll"), symbol_short!("voted")),
            (voter, option, new_count),
        );

        Ok(new_count)
    }

    // ----------------------------------------------------------
    // GET VOTE COUNT (Read-only)
    // ----------------------------------------------------------
    /// Belirli bir seçeneğin oy sayısını döndürür.
    pub fn get_vote_count(env: Env, option: Symbol) -> Result<u32, PollError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::PollNotInitialized);
        }

        let tally: Map<Symbol, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Tally)
            .unwrap();

        Ok(tally.get(option).unwrap_or(0))
    }

    // ----------------------------------------------------------
    // GET OPTIONS (Read-only)
    // ----------------------------------------------------------
    /// Tüm anket seçeneklerini döndürür.
    pub fn get_options(env: Env) -> Result<Vec<Symbol>, PollError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::PollNotInitialized);
        }

        Ok(env.storage().instance().get(&DataKey::Options).unwrap())
    }

    // ----------------------------------------------------------
    // HAS VOTED (Read-only)
    // ----------------------------------------------------------
    /// Bir adresin oy verip vermediğini kontrol eder.
    pub fn has_voted(env: Env, voter: Address) -> bool {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return false;
        }

        let voters: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&DataKey::Voters)
            .unwrap_or(Map::new(&env));

        voters.contains_key(voter)
    }
}

// Test modülünü dahil et
// `cargo test` komutu bu modülü otomatik olarak çalıştırır.
#[cfg(test)]
mod test;

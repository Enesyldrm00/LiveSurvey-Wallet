#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    symbol_short,
    Address, Env, Symbol, Vec,
};

// ============================================================
// STORAGE KEYS
// ============================================================
// Soroban'da depolama için tip-güvenli anahtarlar kullanırız.
// Bu enum, kontratımızdaki tüm depolama anahtarlarını tanımlar.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,           // Anket yöneticisinin adresi
    Options,         // Geçerli anket seçenekleri listesi (Vec<Symbol>)
    VoteCount(Symbol), // Her seçenek için oy sayısı (Persistent)
    HasVoted(Address), // Bir adresin oy verip vermediği (Persistent)
    Initialized,     // Anketin başlatılıp başlatılmadığı
}

// ============================================================
// CUSTOM ERRORS
// ============================================================
// Hata kodları u32 olarak tanımlanır ve Soroban tarafından
// istemciye iletilir. Bu, frontend'in hatayı anlamasını sağlar.
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
    /// Anket zaten başlatılmış (tekrar initialize edilemez)
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
    /// - `options`: Geçerli oy seçenekleri listesi (Symbol)
    ///
    /// # Örnek
    /// ```
    /// initialize(env, admin_address, vec![symbol_short!("evet"), symbol_short!("hayir")])
    /// ```
    pub fn initialize(
        env: Env,
        admin: Address,
        options: Vec<Symbol>,
    ) -> Result<(), PollError> {
        // Anket zaten başlatılmışsa hata döndür
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::AlreadyInitialized);
        }

        // Admin'in bu işlemi yetkilendirmesini zorunlu kıl
        admin.require_auth();

        // Admin adresini kaydet
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Seçenekleri kaydet
        env.storage().instance().set(&DataKey::Options, &options);

        // Her seçenek için başlangıç oy sayısını 0 olarak ayarla
        for option in options.iter() {
            env.storage()
                .persistent()
                .set(&DataKey::VoteCount(option.clone()), &0u32);
        }

        // Anketin başlatıldığını işaretle
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
    /// - Her adres yalnızca bir kez oy verebilir
    /// - Yalnızca geçerli seçeneklere oy verilebilir
    ///
    /// # Events
    /// Başarılı her oylamada `poll_voted` eventi yayınlanır.
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

        // 3. Bu adres daha önce oy verdiyse hata döndür
        if env
            .storage()
            .persistent()
            .has(&DataKey::HasVoted(voter.clone()))
        {
            return Err(PollError::AlreadyVoted);
        }

        // 4. Seçeneğin geçerli olup olmadığını kontrol et
        let options: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::Options)
            .unwrap();

        let is_valid = options.iter().any(|o| o == option);
        if !is_valid {
            return Err(PollError::InvalidOption);
        }

        // 5. Mevcut oy sayısını al ve 1 artır
        let current_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::VoteCount(option.clone()))
            .unwrap_or(0);

        let new_count = current_count + 1;

        // 6. Yeni oy sayısını kaydet (Persistent storage)
        env.storage()
            .persistent()
            .set(&DataKey::VoteCount(option.clone()), &new_count);

        // 7. Bu adresi "oy verdi" olarak işaretle
        env.storage()
            .persistent()
            .set(&DataKey::HasVoted(voter.clone()), &true);

        // 8. EVENT YAYINLA — Frontend bu eventi dinleyerek
        //    gerçek zamanlı güncelleme yapabilir
        //
        //    Event yapısı:
        //    - topics: ["poll_voted", <option>]
        //    - data:   <new_count>
        env.events().publish(
            (symbol_short!("poll"), symbol_short!("voted"), option.clone()),
            new_count,
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

        let count = env
            .storage()
            .persistent()
            .get(&DataKey::VoteCount(option))
            .unwrap_or(0);

        Ok(count)
    }

    // ----------------------------------------------------------
    // GET OPTIONS (Read-only)
    // ----------------------------------------------------------
    /// Tüm anket seçeneklerini döndürür.
    pub fn get_options(env: Env) -> Result<Vec<Symbol>, PollError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(PollError::PollNotInitialized);
        }

        let options = env
            .storage()
            .instance()
            .get(&DataKey::Options)
            .unwrap();

        Ok(options)
    }

    // ----------------------------------------------------------
    // HAS VOTED (Read-only)
    // ----------------------------------------------------------
    /// Bir adresin oy verip vermediğini kontrol eder.
    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::HasVoted(voter))
    }
}

// ============================================================
// TESTS
// ============================================================
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env, Symbol};

    fn setup() -> (Env, PollContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, PollContract);
        let client = PollContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        (env, client, admin)
    }

    #[test]
    fn test_initialize_and_vote() {
        let (env, client, admin) = setup();

        let options = vec![
            &env,
            Symbol::new(&env, "evet"),
            Symbol::new(&env, "hayir"),
        ];

        client.initialize(&admin, &options);

        // İlk oy
        let voter1 = Address::generate(&env);
        let count = client.vote(&voter1, &Symbol::new(&env, "evet"));
        assert_eq!(count, 1);

        // İkinci farklı kullanıcı
        let voter2 = Address::generate(&env);
        let count2 = client.vote(&voter2, &Symbol::new(&env, "evet"));
        assert_eq!(count2, 2);

        // Oy sayısını kontrol et
        assert_eq!(client.get_vote_count(&Symbol::new(&env, "evet")), 2);
        assert_eq!(client.get_vote_count(&Symbol::new(&env, "hayir")), 0);
    }

    #[test]
    fn test_already_voted_error() {
        let (env, client, admin) = setup();

        let options = vec![&env, Symbol::new(&env, "evet")];
        client.initialize(&admin, &options);

        let voter = Address::generate(&env);
        client.vote(&voter, &Symbol::new(&env, "evet"));

        // Aynı kullanıcı tekrar oy vermeye çalışırsa hata almalı
        let result = client.try_vote(&voter, &Symbol::new(&env, "evet"));
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_option_error() {
        let (env, client, admin) = setup();

        let options = vec![&env, Symbol::new(&env, "evet")];
        client.initialize(&admin, &options);

        let voter = Address::generate(&env);
        let result = client.try_vote(&voter, &Symbol::new(&env, "belki"));
        assert!(result.is_err());
    }

    #[test]
    fn test_poll_not_initialized_error() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, PollContract);
        let client = PollContractClient::new(&env, &contract_id);

        let voter = Address::generate(&env);
        let result = client.try_vote(&voter, &Symbol::new(&env, "evet"));
        assert!(result.is_err());
    }
}

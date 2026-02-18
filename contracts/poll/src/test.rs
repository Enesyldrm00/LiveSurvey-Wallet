#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    vec, Address, Env, IntoVal, Symbol,
};

// ============================================================
// TEST HELPERS
// ============================================================

/// Ortak test ortamı kurulumu.
/// `mock_all_auths()` ile tüm `require_auth()` çağrıları otomatik
/// onaylanır — gerçek imza simülasyonu gerekmez.
fn setup_env() -> (Env, PollContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PollContract);
    let client = PollContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    (env, client, admin)
}

/// Standart seçeneklerle anketi başlatan yardımcı fonksiyon.
fn initialize_poll(env: &Env, client: &PollContractClient, admin: &Address) {
    let options = vec![
        env,
        Symbol::new(env, "evet"),
        Symbol::new(env, "hayir"),
        Symbol::new(env, "belki"),
    ];
    client.initialize(admin, &options);
}

// ============================================================
// TEST CASE 1: Başarılı Başlatma ve Oy Verme
// ============================================================
/// Anketin doğru başlatıldığını ve oy verme işleminin çalıştığını
/// doğrular. Birden fazla kullanıcının farklı seçeneklere oy
/// verebileceğini ve sayıların doğru biriktiğini test eder.
#[test]
fn test_successful_initialization_and_voting() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    // Seçeneklerin doğru yüklendiğini kontrol et
    let options = client.get_options();
    assert_eq!(options.len(), 3);

    // Voter 1: "evet" oyu
    let voter1 = Address::generate(&env);
    let count = client.vote(&voter1, &Symbol::new(&env, "evet"));
    assert_eq!(count, 1, "İlk oy sonrası sayı 1 olmalı");

    // Voter 2: "evet" oyu
    let voter2 = Address::generate(&env);
    let count = client.vote(&voter2, &Symbol::new(&env, "evet"));
    assert_eq!(count, 2, "İkinci oy sonrası sayı 2 olmalı");

    // Voter 3: "hayir" oyu
    let voter3 = Address::generate(&env);
    let count = client.vote(&voter3, &Symbol::new(&env, "hayir"));
    assert_eq!(count, 1, "Hayır seçeneği ilk oyunu almalı");

    // Nihai sayıları doğrula
    assert_eq!(client.get_vote_count(&Symbol::new(&env, "evet")), 2);
    assert_eq!(client.get_vote_count(&Symbol::new(&env, "hayir")), 1);
    assert_eq!(client.get_vote_count(&Symbol::new(&env, "belki")), 0);

    // has_voted kontrolü
    assert!(client.has_voted(&voter1));
    assert!(client.has_voted(&voter2));
    assert!(!client.has_voted(&Address::generate(&env)));
}

// ============================================================
// TEST CASE 2: Çift Oy Hatası (AlreadyVoted)
// ============================================================
/// Aynı adresin iki kez oy vermeye çalışması durumunda
/// `AlreadyVoted` hatasının döndürüldüğünü doğrular.
#[test]
fn test_double_voting_returns_already_voted_error() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    let voter = Address::generate(&env);
    let option = Symbol::new(&env, "evet");

    // İlk oy başarılı olmalı
    let result = client.vote(&voter, &option);
    assert_eq!(result, 1);

    // İkinci oy AlreadyVoted hatası vermeli
    let result = client.try_vote(&voter, &option);
    assert!(
        result.is_err(),
        "Aynı kullanıcı iki kez oy veremez"
    );

    let err = result.unwrap_err().unwrap();
    assert_eq!(
        err,
        PollError::AlreadyVoted,
        "Hata kodu AlreadyVoted (2) olmalı"
    );
}

// ============================================================
// TEST CASE 3: Geçersiz Seçenek Hatası (InvalidOption)
// ============================================================
/// Listede olmayan bir seçeneğe oy verilmeye çalışıldığında
/// `InvalidOption` hatasının döndürüldüğünü doğrular.
#[test]
fn test_invalid_option_returns_error() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    let voter = Address::generate(&env);
    // "kesinlikle" seçeneği listede yok
    let invalid_option = Symbol::new(&env, "kesinlikle");

    let result = client.try_vote(&voter, &invalid_option);
    assert!(
        result.is_err(),
        "Geçersiz seçenek için hata bekleniyor"
    );

    let err = result.unwrap_err().unwrap();
    assert_eq!(
        err,
        PollError::InvalidOption,
        "Hata kodu InvalidOption (3) olmalı"
    );
}

// ============================================================
// TEST CASE 4: Event Doğrulaması
// ============================================================
/// Başarılı bir oy işleminin ardından doğru event'in
/// yayınlandığını doğrular.
///
/// Event yapısı:
///   topics: ("poll", "voted")
///   data:   (voter_address, option, new_count)
///
/// NOT: soroban_sdk::Val PartialEq implement etmez.
/// Bu yüzden env.events().all() ile soroban_sdk::vec! karşılaştırması kullanırız.
#[test]
fn test_vote_emits_correct_event() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    let voter = Address::generate(&env);
    let option = Symbol::new(&env, "evet");

    // Oy ver
    client.vote(&voter, &option);

    // Soroban'da event doğrulamanın standart yolu:
    // env.events().all() döndürdüğü Vec, soroban_sdk::vec! ile karşılaştırılır.
    // Her eleman: (contract_address, topics_vec, data_val)
    assert_eq!(
        env.events().all(),
        soroban_sdk::vec![
            &env,
            (
                client.address.clone(),
                soroban_sdk::vec![
                    &env,
                    symbol_short!("poll").into_val(&env),
                    symbol_short!("voted").into_val(&env),
                ],
                (voter.clone(), option.clone(), 1u32).into_val(&env),
            )
        ],
        "Event topics ve data beklenen değerlerle eşleşmeli"
    );
}

// ============================================================
// TEST CASE 5: Başlatılmamış Anket Hatası
// ============================================================
/// `initialize()` çağrılmadan `vote()` çağrıldığında
/// `PollNotInitialized` hatasının döndürüldüğünü doğrular.
#[test]
fn test_vote_on_uninitialized_poll() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PollContract);
    let client = PollContractClient::new(&env, &contract_id);

    let voter = Address::generate(&env);
    let result = client.try_vote(&voter, &Symbol::new(&env, "evet"));

    assert!(result.is_err());
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, PollError::PollNotInitialized);
}

// ============================================================
// TEST CASE 6: Tekrar Başlatma Hatası
// ============================================================
/// Zaten başlatılmış bir anketin tekrar başlatılmaya çalışılması
/// durumunda `AlreadyInitialized` hatasının döndürüldüğünü doğrular.
#[test]
fn test_double_initialization_returns_error() {
    let (env, client, admin) = setup_env();
    initialize_poll(&env, &client, &admin);

    let options = vec![&env, Symbol::new(&env, "evet")];
    let result = client.try_initialize(&admin, &options);

    assert!(result.is_err());
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, PollError::AlreadyInitialized);
}

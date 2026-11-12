import { createContext, useContext, useState, useEffect } from 'react';

const DICTIONARY = {
  en: {
    appTitle: 'Store Audit',
    appSub: 'Inventory Count & Verification',
    quickCount: 'Quick Count',
    managerAudit: 'Manager Audit',
    history: 'Audit History',
    countTab: 'New Count',
    historyTab: 'Past Audits',
    selectStore: 'Select Store',
    auditDate: 'Audit Date',
    searchPlaceholder: 'Search ingredients...',
    allCategories: 'All Categories',
    previousCount: 'Last Audit',
    currentCount: 'Current Count',
    unit: 'Unit',
    saveCount: 'Submit Audit',
    saving: 'Saving...',
    saveSuccess: 'Audit submitted successfully!',
    draftRestored: 'Unsaved draft restored',
    clearDraft: 'Clear Draft',
    itemsCounted: 'Items Counted',
    fillProgress: 'Counted',
    statusApproved: 'Approved',
    statusPending: 'Pending',
    statusRejected: 'Rejected',
    approve: 'Approve',
    reject: 'Reject',
    delete: 'Delete',
    exportCsv: 'Export CSV',
    backToCount: '← New Count',
    confirmDelete: 'Are you sure you want to delete this audit?',
    incompleteWarning: 'Some items are not counted yet. Do you want to submit anyway?',
    varianceWarning: 'Large variance detected for highlighted items',
    pinTitle: 'Enter Access PIN',
    pinSubtitle: '1234 for Quick Count (Barista) · 7530 for Manager Suite',
    incorrectPin: 'Incorrect PIN. Please try again.',
    signOut: 'Sign out',
    noAuditsFound: 'No audits found for this store',
    viewDetails: 'View Details',
    hideDetails: 'Hide Details',
    edit: 'Edit',
    cancelEdit: 'Cancel Editing',
    updateCount: 'Update Audit',
    editingNotice: 'Editing Audit',
    existingAuditNotice: 'An audit already exists for this store on this date. Saving will update the existing record.',
    loadExisting: 'Load Existing Record',
    chooseStorePrompt: 'Which store are you counting?',
    chooseStoreHint: 'Pick the location — the audit will be saved exactly for it',
    confirmTitle: 'Check before submitting',
    confirmStore: 'Store',
    confirmDate: 'Date',
    confirmItems: 'Items Counted',
    confirmSubmit: 'Confirm & Submit',
    confirmIncomplete: 'Some items are not counted yet — they will be left blank.',
    confirmEmpty: 'Nothing is counted yet — fill at least one item.',
    noStoreChosen: 'Choose the store first',
    futureDateBlock: 'Date is in the future — check the device date. Import blocked.',
    backdateWarn: 'This date is older than the last audit for this store.',
    backdateBlock: 'An audit dated after this already exists — backdated counts are not allowed.',
    lhPushWarning: 'Saved to database — but the lakehouse will catch up overnight.',
    importTab: 'CSV Import',
  },
  ru: {
    appTitle: 'Инвентаризация',
    appSub: 'Учёт остатков и ревизия',
    quickCount: 'Быстрый пересчёт',
    managerAudit: 'Управление ревизиями',
    history: 'История ревизий',
    countTab: 'Новый пересчёт',
    historyTab: 'История ревизий',
    selectStore: 'Выберите филиал',
    auditDate: 'Дата ревизии',
    searchPlaceholder: 'Поиск ингредиентов...',
    allCategories: 'Все категории',
    previousCount: 'Пред. ревизия',
    currentCount: 'Факт. остаток',
    unit: 'Ед.',
    saveCount: 'Отправить ревизию',
    saving: 'Сохранение...',
    saveSuccess: 'Ревизия успешно сохранена!',
    draftRestored: 'Черновик восстановлен',
    clearDraft: 'Очистить черновик',
    itemsCounted: 'Позиций посчитано',
    fillProgress: 'Заполнено',
    statusApproved: 'Утверждено',
    statusPending: 'На проверке',
    statusRejected: 'Отклонено',
    approve: 'Утвердить',
    reject: 'Отклонить',
    delete: 'Удалить',
    exportCsv: 'Скачать CSV',
    backToCount: '← К пересчёту',
    confirmDelete: 'Вы уверены, что хотите удалить эту ревизию?',
    incompleteWarning: 'Не все позиции заполнены. Отправить ревизию всё равно?',
    varianceWarning: 'Обнаружено сильное расхождение по выделенным позициям',
    pinTitle: 'Введите PIN-код',
    pinSubtitle: '1234 для бариста · 7530 для менеджера',
    incorrectPin: 'Неверный PIN-код. Попробуйте снова.',
    signOut: 'Выйти',
    noAuditsFound: 'Ревизии для этого филиала не найдены',
    viewDetails: 'Подробнее',
    hideDetails: 'Скрыть',
    edit: 'Редактировать',
    cancelEdit: 'Отменить редактирование',
    updateCount: 'Обновить ревизию',
    editingNotice: 'Редактирование ревизии',
    existingAuditNotice: 'Ревизия на эту дату уже существует. Сохранение обновит запись.',
    loadExisting: 'Загрузить существующие данные',
    chooseStorePrompt: 'Какую точку пересчитываете?',
    chooseStoreHint: 'Выберите точку — ревизия будет сохранена именно для неё',
    confirmTitle: 'Проверьте перед отправкой',
    confirmStore: 'Точка',
    confirmDate: 'Дата',
    confirmItems: 'Позиций посчитано',
    confirmSubmit: 'Подтвердить и отправить',
    confirmIncomplete: 'Не все позиции заполнены — пустые будут пропущены.',
    confirmEmpty: 'Ни одна позиция не заполнена — заполните хотя бы одну.',
    noStoreChosen: 'Сначала выберите точку',
    futureDateBlock: 'Дата в будущем — проверьте дату на устройстве.',
    backdateWarn: 'Эта дата старше последней ревизии точки.',
    backdateBlock: 'Уже есть ревизия за более позднюю дату — ревизии задним числом запрещены.',
    lhPushWarning: 'Сохранено в базу — озеро данных обновится ночью.',
    importTab: 'Импорт CSV',
  }
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('bc_lang') || 'ru');

  useEffect(() => {
    localStorage.setItem('bc_lang', lang);
  }, [lang]);

  const toggleLang = () => setLang(prev => (prev === 'ru' ? 'en' : 'ru'));

  const t = (key) => DICTIONARY[lang]?.[key] || DICTIONARY['en']?.[key] || key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}


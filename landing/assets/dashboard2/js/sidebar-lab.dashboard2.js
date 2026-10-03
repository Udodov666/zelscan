// ===== SidebarLab — universal sidebar with 12 variants =====
(function(){
  const SIDEBAR_HTML = `<aside

        class="sidebar"

        id="sidebarLab"

        data-variant="1"

        aria-label="Основная навигация"

      >

        <div class="sidebar-inner">

          <div class="sb-nav-zone">

            <div class="sb-section-label">Навигация</div>



            <nav class="sb-nav sb-primary" aria-label="Основные разделы">

              <a class="sb-item" href="/app">

                <span class="sb-icon" aria-hidden="true">

                  <i class="fa-solid fa-house sb-icon-solid"></i>



                  <svg class="sb-icon-line" viewBox="0 0 24 24">

                    <path d="M3 11.5 12 4l9 7.5"/>

                    <path d="M5.5 10.5V20h13v-9.5"/>

                    <path d="M9.5 20v-6h5v6"/>

                  </svg>

                </span>



                <span class="sb-label">Дашборд</span>

                <span class="sb-meta" aria-hidden="true"></span>

              </a>



              <a

                class="sb-item is-active"

                href="/dossiers"

                aria-current="page"

              >

                <span class="sb-icon" aria-hidden="true">

                  <i class="fa-solid fa-database sb-icon-solid"></i>



                  <svg class="sb-icon-line" viewBox="0 0 24 24">

                    <ellipse cx="12" cy="5" rx="8" ry="3"/>

                    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>

                    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>

                  </svg>

                </span>



                <span class="sb-label">Мои досье</span>



                <span class="sb-meta" aria-hidden="true">

                  <span class="sb-count" data-count="my_dossiers">0</span>

                </span>

              </a>



              <a class="sb-item" href="/explore">

                <span class="sb-icon" aria-hidden="true">

                  <i class="fa-solid fa-earth-europe sb-icon-solid"></i>



                  <svg class="sb-icon-line" viewBox="0 0 24 24">

                    <circle cx="12" cy="12" r="9"/>

                    <path d="M3 12h18"/>

                    <path d="M12 3a15 15 0 0 1 0 18"/>

                    <path d="M12 3a15 15 0 0 0 0 18"/>

                  </svg>

                </span>



                <span class="sb-label">Общие досье</span>



                <span class="sb-meta" aria-hidden="true">


                  <span class="sb-count" data-count="public_dossiers">0</span>

                </span>

              </a>



              <a class="sb-item has-alert" href="/billing">

                <span class="sb-icon" aria-hidden="true">

                  <i class="fa-solid fa-receipt sb-icon-solid"></i>



                  <svg class="sb-icon-line" viewBox="0 0 24 24">

                    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/>

                    <path d="M9 8h6"/>

                    <path d="M9 12h6"/>

                    <path d="M9 16h3"/>

                  </svg>

                </span>



                <span class="sb-label">Транзакции</span>



                <span class="sb-meta" aria-hidden="true">

                  <span class="sb-count" data-count="transactions">0</span>

                </span>

              </a>

            </nav>



            <div class="sb-divider" aria-hidden="true"></div>

            <div class="sb-section-label is-secondary">Сервис</div>



            <nav class="sb-nav sb-secondary" aria-label="Сервис">

              <a

                class="sb-item"

                href="/updates"

              >

                <span class="sb-icon" aria-hidden="true">

                  <i class="fa-solid fa-newspaper sb-icon-solid"></i>



                  <svg class="sb-icon-line" viewBox="0 0 24 24">

                    <path d="M4 5h13v14H5a2 2 0 0 1-2-2V6"/>

                    <path d="M17 8h3v9a2 2 0 0 1-2 2h-1"/>

                    <path d="M7 8h6M7 11h6M7 14h4"/>

                  </svg>

                </span>



                <span class="sb-label">Новости</span>



                <span class="sb-meta" aria-hidden="true">


                </span>

              </a>

            </nav>

          </div>



          <!-- Переключатель вариантов вместо sb-user -->

          <div class="sb-variant-switcher" id="sidebarVariantSwitcher">

            <div class="sb-switch-row">

              <button

                class="sb-switch-step"

                id="sidebarVariantPrev"

                type="button"

                aria-label="Предыдущий вариант меню"

                title="Предыдущий вариант · Alt + ←"

              >

                <svg viewBox="0 0 24 24" aria-hidden="true">

                  <path d="m15 18-6-6 6-6"/>

                </svg>

              </button>



              <button

                class="sb-switch-current"

                id="sidebarVariantTrigger"

                type="button"

                aria-haspopup="dialog"

                aria-expanded="false"

                aria-controls="sidebarVariantPicker"

              >

                <span class="sb-switch-copy">

                  <span class="sb-switch-eyebrow">Вид меню</span>

                  <span class="sb-switch-name" id="sidebarVariantName">

                    Капсула

                  </span>

                </span>



                <span class="sb-switch-number" id="sidebarVariantNumber">

                  01

                </span>

              </button>



              <button

                class="sb-switch-step"

                id="sidebarVariantNext"

                type="button"

                aria-label="Следующий вариант меню"

                title="Следующий вариант · Alt + →"

              >

                <svg viewBox="0 0 24 24" aria-hidden="true">

                  <path d="m9 18 6-6-6-6"/>

                </svg>

              </button>

            </div>



            <div

              class="sb-variant-picker"

              id="sidebarVariantPicker"

              role="dialog"

              aria-label="Выбор варианта бокового меню"

              hidden

            >

              <div class="sb-picker-head">

                <div>

                  <h2 class="sb-picker-title">Вариант меню</h2>

                  <p class="sb-picker-sub">

                    Переключение не перезагружает страницу.

                  </p>

                </div>



                <span class="sb-picker-shortcut">Alt + ← →</span>

              </div>



              <section class="sb-picker-group" aria-label="Референс один">

                <h3 class="sb-picker-group-title">Референс 01</h3>



                <div class="sb-picker-grid">

                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="1"

                    aria-pressed="true"

                  >

                    <span class="sb-option-number">01</span>

                    <span class="sb-option-label">Капсула</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="2"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">02</span>

                    <span class="sb-option-label">Compact</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="3"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">03</span>

                    <span class="sb-option-label">Icon focus</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="4"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">04</span>

                    <span class="sb-option-label">Quiet line</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="5"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">05</span>

                    <span class="sb-option-label">Bold soft</span>

                  </button>

                </div>

              </section>



              <section class="sb-picker-group" aria-label="Референс два">

                <h3 class="sb-picker-group-title">Референс 02</h3>



                <div class="sb-picker-grid">

                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="6"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">06</span>

                    <span class="sb-option-label">League rail</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="7"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">07</span>

                    <span class="sb-option-label">Compact rail</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="8"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">08</span>

                    <span class="sb-option-label">Badges</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="9"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">09</span>

                    <span class="sb-option-label">Dense</span>

                  </button>

                </div>

              </section>



              <section class="sb-picker-group" aria-label="Смешанные варианты">

                <h3 class="sb-picker-group-title">Смешанный стиль</h3>



                <div class="sb-picker-grid">

                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="10"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">10</span>

                    <span class="sb-option-label">Pill rail</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="11"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">11</span>

                    <span class="sb-option-label">Icon mix</span>

                  </button>



                  <button

                    class="sb-variant-option"

                    type="button"

                    data-sidebar-variant="12"

                    aria-pressed="false"

                  >

                    <span class="sb-option-number">12</span>

                    <span class="sb-option-label">Minimal</span>

                  </button>

                </div>

              </section>

            </div>



            <span

              class="sb-live-region"

              id="sidebarVariantLive"

              aria-live="polite"

            ></span>

          </div>

          <div class="sb-bottom-group">
            <a class="sb-author-tos" href="#" id="tosTrigger" title="Пользовательское соглашение" aria-label="Пользовательское соглашение"><span class="sb-tos-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/></svg></span><span class="sb-tos-tx">Пользовательское соглашение</span></a>
            <a class="sb-author-tos" href="#" id="privacyTrigger" title="Политика конфиденциальности" aria-label="Политика конфиденциальности"><span class="sb-tos-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 2.6v5.1c0 4.3-2.9 8.2-7 9.8-4.1-1.6-7-5.5-7-9.8V5.6z"/><path d="M9.3 11.7l2 2 3.6-4.2"/></svg></span><span class="sb-tos-tx">Политика конфиденциальности</span></a>
            <div class="sb-author-row">
              <span class="sb-author-label">Создал</span>
              <div class="sb-author-badge" id="profileTrigger" title="Дмитрий Удодов">
                <div class="sb-author-av"><img src="images/avava.png" alt=""></div>
                <span class="sb-author-name">Дмитрий Удодов</span>
              </div>
            </div>
          </div>

        </div>

      </aside>

<div class="modal-overlay" id="profileModal">
  <div class="zs-modal">
    <button class="zs-modal-x" data-zs-call="ZSModals.close()">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 00-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 10-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 101.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 001.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 000-1.09z" fill="currentColor"/></svg>
    </button>
    <div class="modal-header">
      <img class="modal-avatar" src="images/avava.png" alt="">
      <div class="modal-header-info">
        <div class="modal-name">Дмитрий Удодов</div>
        <div class="modal-nick">@lolz_nickname</div>
      </div>
    </div>
    <div class="modal-desc">Product Designer & AI-Integrator. Создаю проекты на стыке дизайна, кода и нейросетей под ключ.</div>
    <div class="modal-projects">
      <div class="modal-projects-lbl">Портфолио</div>
      <div class="modal-projects-scroll">
        <div class="modal-pcard" style="background:url('images/preview.png') center/cover no-repeat;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;text-align:center"><span style="color:#fff;font-size:11px;font-weight:400;line-height:1.3;display:block">Редизайн платформы<br>и внедрение AI</span></div>
        <div class="modal-pcard" style="background:url('images/preview2.png') center/cover no-repeat;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;text-align:center"><span style="color:#1C1C1E;font-size:11px;font-weight:400;line-height:1.3;display:block">Дизайн и брендинг<br>криптообменника</span></div>
        <div class="modal-pcard" style="background:url('images/preview3.png') center/cover no-repeat;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;text-align:center"><span style="color:#fff;font-size:11px;font-weight:400;line-height:1.3;display:block">Лендинг<br>NFT мессенджера</span></div>
        <div class="modal-pcard" style="background:url('images/preview4.png') center/cover no-repeat;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;text-align:center"><span style="color:#fff;font-size:11px;font-weight:400;line-height:1.3;display:block">Креативы и баннеры<br>для бук. компаний</span></div>
        <div class="modal-pcard" style="background:url('images/preview5.png') center/cover no-repeat;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;text-align:center"><span style="color:#fff;font-size:11px;font-weight:400;line-height:1.3;display:block">Детейлинг чат-бот<br>с CRM системой</span></div>
      </div>
    </div>
    <a class="modal-tg-btn" href="https://t.me/lolz_nickname" target="_blank">
      <img src="images/telegram.svg" width="22" height="22" alt="Telegram">
      Написать в Telegram
    </a>
  </div>
</div>
<div class="modal-overlay" id="zsTosOverlay" role="dialog" aria-modal="true" aria-labelledby="zsTosTitle" aria-hidden="true">
  <div class="zs-modal zs-tos-modal" tabindex="-1">
    <button class="zs-modal-x" type="button" aria-label="Закрыть пользовательское соглашение"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 00-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 10-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 101.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 001.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 000-1.09z" fill="currentColor"/></svg></button>
    <header class="zs-tos-header">
      <h2 id="zsTosTitle" class="modal-name">Пользовательское соглашение</h2>
      <p class="zs-tos-edition">Редакция от 4 сентября 2026 года</p>
    </header>
    <div class="zs-tos-body">
      <section class="zs-tos-section">
        <h3>1. Общие положения</h3>
        <p>Настоящее Пользовательское соглашение регулирует использование сервиса Zelscan. Редакция действует с 4 сентября 2026 года.</p>
        <p>Используя сервис, пользователь принимает условия настоящего соглашения.</p>
      </section>
      <section class="zs-tos-section">
        <h3>2. Принятие соглашения и возраст</h3>
        <p>Используя сервис, создавая аккаунт или заказывая отчет, пользователь подтверждает принятие настоящего соглашения.</p>
        <p>Сервис предназначен только для лиц, достигших 18 лет. Если пользователь не согласен с условиями, он обязан прекратить использование сервиса.</p>
      </section>
      <section class="zs-tos-section">
        <h3>3. Авторизация через Lolzteam</h3>
        <p>Вход выполняется посредством OAuth Lolzteam. Пользователь разрешает получить необходимые для авторизации сведения в объеме, предоставляемом Lolzteam.</p>
        <p>OAuth-токен сервисом не хранится. Пользователь отвечает за безопасность своей учетной записи Lolzteam и действий, совершенных после авторизации.</p>
      </section>
      <section class="zs-tos-section">
        <h3>4. Функции сервиса</h3>
        <p>Сервис предоставляет бесплатные функции и платные AI-отчеты по публичным данным Lolzteam. Состав, доступность и ограничения бесплатных функций могут меняться.</p>
        <p>Платный отчет формируется по выбранному пользователем объекту и является цифровым результатом работы сервиса; его содержание ограничено доступными данными и возможностями используемых моделей.</p>
      </section>
      <section class="zs-tos-section">
        <h3>5. Платежи и мерчант Lolzteam</h3>
        <p>Внутренний баланс пополняется, а расчеты за AI-отчеты проводятся исключительно через мерчанта Lolzteam. Сервис не принимает оплату иными способами, если прямо не указано обратное в интерфейсе.</p>
        <p>Стоимость и количество зачисляемых единиц показываются до подтверждения операции. Комиссии и правила платежной инфраструктуры могут определяться Lolzteam.</p>
      </section>
      <section class="zs-tos-section">
        <h3>6. Добровольная поддержка</h3>
        <p>Пользователь может отдельно оказать владельцу добровольную безвозмездную поддержку без встречного предоставления товаров, работ, услуг, единиц баланса или иных преимуществ.</p>
        <p>Такая поддержка не является оплатой AI-отчета и не создает обязанности предоставить пользователю результат или привилегию.</p>
      </section>
      <section class="zs-tos-section">
        <h3>7. Пополнение баланса для отчетов</h3>
        <p>Пополнение внутреннего баланса для последующей оплаты AI-отчетов является авансовым внесением средств на цели использования платных функций сервиса и не является добровольной поддержкой.</p>
        <p>Зачисленные единицы используются только для оплаты отчетов на условиях, показанных в интерфейсе.</p>
      </section>
      <section class="zs-tos-section">
        <h3>8. Внутренние единицы</h3>
        <p>Единицы внутреннего баланса являются техническим способом учета права оплатить функции сервиса; они не являются валютой, электронными деньгами, ценной бумагой или самостоятельным имуществом.</p>
        <p>Единицы нельзя вывести, передать другому лицу, обменять вне сервиса или использовать иначе, чем для предусмотренных платных функций.</p>
      </section>
      <section class="zs-tos-section">
        <h3>9. Списание и технические ошибки</h3>
        <p>Единицы списываются при заказе платного отчета. Если отчет не сформирован из-за подтвержденной технической ошибки сервиса, списанные единицы восстанавливаются на внутренний баланс.</p>
        <p>Восстановление может не производиться, если результат был предоставлен, ошибка вызвана действиями пользователя, недоступностью сторонней платформы либо нарушением соглашения, кроме случаев, когда закон требует иного.</p>
      </section>
      <section class="zs-tos-section">
        <h3>10. Ошибочные платежи и возвраты</h3>
        <p>При ошибочном или двойном платеже пользователь должен обратиться по контактам владельца и предоставить сведения, позволяющие проверить операцию. Возврат проводится после проверки через доступный платежный канал.</p>
      </section>
      <section class="zs-tos-section">
        <h3>11. Источники данных и отсутствие аффилированности</h3>
        <p>Сервис обрабатывает только публично доступные данные Lolzteam и не предназначен для получения закрытой информации или обхода ограничений доступа.</p>
        <p>Сервис и его владелец не аффилированы с Lolzteam, не действуют от его имени и не гарантируют доступность, точность или неизменность данных сторонней платформы.</p>
      </section>
      <section class="zs-tos-section">
        <h3>12. AI-модели и характер результатов</h3>
        <p>Для подготовки отчетов могут использоваться DeepSeek и AKI, а также связанные алгоритмы обработки. Состав моделей может меняться без ухудшения обязательных прав пользователя.</p>
        <p>AI-выводы вероятностны: они могут быть неполными, неточными или ошибочными и не являются установленными фактами, диагнозами, юридическими, финансовыми, медицинскими либо иными профессиональными советами. Существенные выводы следует проверять самостоятельно.</p>
      </section>
      <section class="zs-tos-section">
        <h3>13. Допустимое использование</h3>
        <p>Запрещено использовать сервис для травли, шантажа, доксинга, дискриминации, мошенничества, угроз, преследования или принятия незаконных решений.</p>
        <p>Также запрещены попытки получить закрытые данные, нарушить работу сервиса, обойти ограничения, выдать вероятностный AI-вывод за доказанный факт либо нарушить права третьих лиц.</p>
      </section>
      <section class="zs-tos-section">
        <h3>14. Обрабатываемые данные</h3>
        <p>Сервис может хранить ник, идентификатор пользователя, сведения о заказах и созданные досье в объеме, необходимом для работы функций, учета операций, безопасности и исполнения закона.</p>
        <p>OAuth-токен сервисом не хранится. Пользователь не должен помещать в запросы избыточные персональные, секретные или незаконно полученные сведения.</p>
      </section>
      <section class="zs-tos-section">
        <h3>15. Сроки хранения и удаление</h3>
        <p>Данные хранятся до удаления аккаунта или досье, получения обоснованного запроса на удаление либо пока хранение необходимо для работы сервиса, разрешения споров и исполнения требований закона.</p>
        <p>Пользователь может запросить удаление аккаунта или отдельного досье по контактам владельца либо через доступную функцию интерфейса. Некоторые сведения могут сохраняться в обязательном объеме и сроке, установленном законом.</p>
      </section>
      <section class="zs-tos-section">
        <h3>16. Интеллектуальная собственность</h3>
        <p>Права на программный код, дизайн, тексты, обозначения и иные материалы сервиса принадлежат владельцу или соответствующим правообладателям. Пользователю предоставляется ограниченное право использовать сервис по назначению.</p>
        <p>Запрещены копирование, распространение, модификация, декомпиляция и коммерческое использование материалов без разрешения, кроме случаев, прямо допускаемых законом. Права на исходные публичные данные сохраняются за их правообладателями.</p>
      </section>
      <section class="zs-tos-section">
        <h3>17. Ограничение доступа и блокировки</h3>
        <p>Владелец вправе временно ограничить или заблокировать доступ при нарушении соглашения, угрозе безопасности, злоупотреблении, мошенничестве или требовании закона.</p>
        <p>По возможности учитываются характер и последствия нарушения. Блокировка не отменяет обязательные возвраты и иные права пользователя, которые не могут быть ограничены законом.</p>
      </section>
      <section class="zs-tos-section">
        <h3>18. Изменение и прекращение сервиса</h3>
        <p>Владелец вправе изменять функции, технические требования, цены на будущие заказы, приостанавливать или прекращать сервис, уведомляя пользователей разумным способом, когда это возможно.</p>
        <p>Изменения не применяются задним числом к уже оплаченным и принятым обязательствам. При прекращении сервиса вопросы неиспользованного оплаченного баланса решаются по согласованию с пользователем.</p>
      </section>
      <section class="zs-tos-section">
        <h3>19. Ответственность и изменение соглашения</h3>
        <p>Сервис предоставляется с учетом технических ограничений и зависимости от сторонних платформ. В пределах, допускаемых законом, владелец не отвечает за косвенные убытки, решения пользователя на основе AI-выводов и сбои вне разумного контроля.</p>
        <p>Соглашение может изменяться; новая редакция публикуется в сервисе с датой вступления в силу.</p>
      </section>
      <section class="zs-tos-section">
        <h3>20. Заключительные положения</h3>
        <p>Если отдельное положение соглашения окажется неприменимым, остальные положения продолжают действовать. Заголовки разделов используются только для удобства.</p>
        <p>По вопросам работы сервиса, платежей или удаления данных можно обратиться в поддержку: @udodov228.</p>
      </section>
    </div>
  </div>
</div>
<div class="modal-overlay" id="zsPrivacyOverlay" role="dialog" aria-modal="true" aria-labelledby="zsPrivacyTitle" aria-hidden="true">
  <div class="zs-modal zs-tos-modal" tabindex="-1">
    <button class="zs-modal-x" type="button" aria-label="Закрыть политику конфиденциальности"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 00-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 10-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 101.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 001.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 000-1.09z" fill="currentColor"/></svg></button>
    <header class="zs-tos-header">
      <h2 id="zsPrivacyTitle" class="modal-name">Политика конфиденциальности</h2>
      <p class="zs-tos-edition">Редакция от 4 сентября 2026 года</p>
    </header>
    <div class="zs-tos-body">
      <section class="zs-tos-section">
        <h3>1. Общие сведения</h3>
        <p>Настоящая Политика конфиденциальности описывает, как сервис Zelscan собирает, использует, хранит и защищает информацию пользователей. Политика действует с 4 сентября 2026 года.</p>
        <p>Используя сервис, пользователь соглашается с условиями данной Политики.</p>
      </section>
      <section class="zs-tos-section">
        <h3>2. Какие данные собираются</h3>
        <p><strong>Авторизация:</strong> при входе через OAuth Lolzteam сервис получает публичный профиль пользователя (ник, идентификатор, аватар, публичные данные профиля) в объёме, предоставляемом платформой.</p>
        <p><strong>Технические данные:</strong> IP-адрес, User-Agent, данные cookies, информация о браузере и операционной системе, время обращения, реферер.</p>
        <p><strong>Данные использования:</strong> история заказов, созданные досье, результаты AI-анализа, логи операций, параметры запросов.</p>
        <p><strong>Платёжные данные:</strong> сведения о транзакциях внутри сервиса (суммы, статусы, идентификаторы операций). Банковские реквизиты не обрабатываются — расчёты проводятся через мерчанта Lolzteam.</p>
      </section>
      <section class="zs-tos-section">
        <h3>3. Cookies и аналогичные технологии</h3>
        <p>Сервис использует cookies для аутентификации сессий, обеспечения безопасности, запоминания настроек и аналитики использования.</p>
        <p>Сторонние сервисы (аналитика, хостинг) могут устанавливать собственные cookies в соответствии со своими политиками конфиденциальности.</p>
        <p>Пользователь может отключить cookies в настройках браузера, однако это может повлиять на работоспособность сервиса.</p>
      </section>
      <section class="zs-tos-section">
        <h3>4. Как используются данные</h3>
        <p>Собранная информация используется для:</p>
        <p>• Авторизации и управления аккаунтом;</p>
        <p>• Формирования и доставки заказов, включая AI-отчёты;</p>
        <p>• Обеспечения безопасности, предотвращения мошенничества и злоупотреблений;</p>
        <p>• Аналитики использования сервиса, улучшения функциональности и пользовательского опыта;</p>
        <p>• Обратной связи и поддержки пользователей;</p>
        <p>• Исполнения обязательных требований законодательства.</p>
      </section>
      <section class="zs-tos-section">
        <h3>5. Хранение и защита данных</h3>
        <p>Данные хранятся на защищённых серверах с использованием шифрования при передаче (TLS). Доступ к данным имеют только уполномоченные лица в объёме, необходимом для работы сервиса.</p>
        <p>Срок хранения определяется целью обработки: данные аккаунта хранятся до его удаления; логи и технические данные — до 12 месяцев; платёжные данные — в объёме и сроки, требуемые законом.</p>
      </section>
      <section class="zs-tos-section">
        <h3>6. Доступ к данным</h3>
        <p>Сервис не продаёт персональные данные пользователей.</p>
        <p>Доступ к данным ограничен и используется только в объёме, необходимом для технической работы сервиса, размещения и хранения данных на серверной инфраструктуре.</p>
      </section>
      <section class="zs-tos-section">
        <h3>7. Управление данными</h3>
        <p>Пользователь может обратиться с запросом на исправление данных или удаление аккаунта и связанных с ним данных.</p>
        <p>Для отправки запроса необходимо обратиться по контакту: @udodov228.</p>
      </section>
      <section class="zs-tos-section">
        <h3>8. Безопасность</h3>
        <p>Сервис принимает разумные меры для защиты данных от несанкционированного доступа, изменения, раскрытия или уничтожения. Тем не менее, ни один метод передачи данных через интернет не является абсолютно безопасным.</p>
        <p>Пользователь отвечает за конфиденциальность своих учётных данных Lolzteam и незамедлительно сообщает о подозрительной активности.</p>
      </section>
      <section class="zs-tos-section">
        <h3>9. Изменения Политики</h3>
        <p>Настоящая Политика может изменяться. Новая редакция публикуется в сервисе с указанием даты вступления в силу. Продолжение использования сервиса после публикации изменений означает принятие обновлённых условий.</p>
      </section>
      <section class="zs-tos-section">
        <h3>10. Контакты</h3>
        <p>По вопросам конфиденциальности, обработки данных или удалению аккаунта обращайтесь: @udodov228.</p>
      </section>
    </div>
  </div>
</div>
`;
  
  // Read variant from localStorage
  var variant = parseInt(localStorage.getItem('zelscan-sidebar-variant') || '1');
  if (isNaN(variant) || variant < 1 || variant > 12) variant = 1;
  
  // Inject sidebar CSS
  if (!document.querySelector('link[href*="sidebar-lab.dashboard2.css"]')) {
    var css=document.createElement('link'); css.rel='stylesheet'; css.href='assets/dashboard2/css/sidebar-lab.dashboard2.css'; document.head.appendChild(css);
  }
  
  // Replace old sidebar
  function init(){
    var oldSidebar = document.querySelector('.sidebar');
    if (!oldSidebar) { setTimeout(init, 50); return; }
    
    var div = document.createElement('div');
    div.innerHTML = SIDEBAR_HTML;
    var newSidebar = div.firstElementChild;
    if (!newSidebar) { setTimeout(init, 50); return; }
    
    oldSidebar.parentNode.replaceChild(newSidebar, oldSidebar);
    Array.prototype.slice.call(div.querySelectorAll('.modal-overlay')).forEach(function(modal){
      if (!modal.id || !document.getElementById(modal.id)) document.body.appendChild(modal);
    });
    applyVariant(variant);
    initSwitcher(newSidebar);
    loadCounts(newSidebar);
    // Dashboard2 восстанавливает cookie-сессию асинхронно. Первый защищённый
    // запрос может получить 401, поэтому обновляем счётчики после профиля.
    document.addEventListener('zs:profile', function(){ loadCounts(newSidebar); }, { once: true });
    var trigger=document.getElementById('profileTrigger');
    var modalEl=document.getElementById('profileModal');
    if(trigger&&modalEl){var close=modalEl.querySelector('.zs-modal-x');trigger.addEventListener('click',function(){modalEl.classList.add('-open');});if(close)close.addEventListener('click',function(){modalEl.classList.remove('-open');});modalEl.addEventListener('click',function(e){if(e.target===modalEl)modalEl.classList.remove('-open');});}
    initProjectsDrag(modalEl);
    // TOS modal
    var tosTrigger = document.getElementById('tosTrigger');
    var tosOverlay = document.getElementById('zsTosOverlay');
    if (tosTrigger && tosOverlay) {
      var tosClose = tosOverlay.querySelector('.zs-modal-x');
      var tosDialog = tosOverlay.querySelector('.zs-modal');
      function closeTos(){
        tosOverlay.classList.remove('-open');
        tosOverlay.setAttribute('aria-hidden', 'true');
        tosTrigger.setAttribute('aria-expanded', 'false');
        tosTrigger.focus();
      }
      tosTrigger.setAttribute('aria-controls', 'zsTosOverlay');
      tosTrigger.setAttribute('aria-haspopup', 'dialog');
      tosTrigger.setAttribute('aria-expanded', 'false');
      tosTrigger.addEventListener('click', function(event){
        event.preventDefault();
        tosOverlay.classList.add('-open');
        tosOverlay.setAttribute('aria-hidden', 'false');
        tosTrigger.setAttribute('aria-expanded', 'true');
        if (tosDialog) tosDialog.focus();
      });
      if (tosClose) tosClose.addEventListener('click', closeTos);
      tosOverlay.addEventListener('click', function(event){ if (event.target === tosOverlay) closeTos(); });
      tosOverlay.addEventListener('keydown', function(event){ if (event.key === 'Escape') closeTos(); });
    }
    // Privacy modal
    var privacyTrigger = document.getElementById('privacyTrigger');
    var privacyOverlay = document.getElementById('zsPrivacyOverlay');
    if (privacyTrigger && privacyOverlay) {
      var privacyClose = privacyOverlay.querySelector('.zs-modal-x');
      var privacyDialog = privacyOverlay.querySelector('.zs-modal');
      function closePrivacy(){
        privacyOverlay.classList.remove('-open');
        privacyOverlay.setAttribute('aria-hidden', 'true');
        privacyTrigger.setAttribute('aria-expanded', 'false');
        privacyTrigger.focus();
      }
      privacyTrigger.setAttribute('aria-controls', 'zsPrivacyOverlay');
      privacyTrigger.setAttribute('aria-haspopup', 'dialog');
      privacyTrigger.setAttribute('aria-expanded', 'false');
      privacyTrigger.addEventListener('click', function(event){
        event.preventDefault();
        privacyOverlay.classList.add('-open');
        privacyOverlay.setAttribute('aria-hidden', 'false');
        privacyTrigger.setAttribute('aria-expanded', 'true');
        if (privacyDialog) privacyDialog.focus();
      });
      if (privacyClose) privacyClose.addEventListener('click', closePrivacy);
      privacyOverlay.addEventListener('click', function(event){ if (event.target === privacyOverlay) closePrivacy(); });
      privacyOverlay.addEventListener('keydown', function(event){ if (event.key === 'Escape') closePrivacy(); });
    }
    // Mobile (<=900px): the sidebar is hidden — render a page footer at the
    // end of the content: legal links on the left, author credit on the right.
    // The modals are reused via the (hidden) sidebar triggers.
    (function(){
      var host = document.querySelector('.main') || document.querySelector('.content') || document.body;
      if (document.getElementById('zsPageFoot')) return;
      var foot = document.createElement('footer');
      foot.className = 'zs-page-foot';
      foot.id = 'zsPageFoot';
      foot.innerHTML =
        '<div class="zpf-links">' +
          '<a class="zpf-link" href="#" data-zpf-target="tosTrigger">Пользовательское соглашение</a>' +
          '<a class="zpf-link" href="#" data-zpf-target="privacyTrigger">Политика конфиденциальности</a>' +
        '</div>' +
        '<div class="zpf-author">' +
          '<span class="zpf-badge" data-zpf-target="profileTrigger" title="Дмитрий Удодов">' +
            '<span class="zpf-av"><img src="images/avava.png" alt=""></span>' +
            '<span class="zpf-name">Дмитрий Удодов</span>' +
          '</span>' +
        '</div>';
      foot.addEventListener('click', function(event){
        var t = event.target.closest('[data-zpf-target]');
        if (!t) return;
        var trg = document.getElementById(t.getAttribute('data-zpf-target'));
        if (!trg) return;
        event.preventDefault();
        trg.click();
      });
      host.appendChild(foot);
    })();
  }

  function initProjectsDrag(modalEl){
    var scroller = modalEl && modalEl.querySelector('.modal-projects-scroll');
    if (!scroller || scroller.dataset.dragScrollReady === 'true') return;
    scroller.dataset.dragScrollReady = 'true';

    var pointerId = null;
    var startX = 0;
    var startScrollLeft = 0;

    function finishDrag(event){
      if (pointerId === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return;
      var activePointerId = pointerId;
      pointerId = null;
      scroller.classList.remove('is-dragging');
      if (scroller.hasPointerCapture && scroller.hasPointerCapture(activePointerId)) {
        scroller.releasePointerCapture(activePointerId);
      }
    }

    scroller.addEventListener('pointerdown', function(event){
      if (!event.isPrimary || pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = scroller.scrollLeft;
      scroller.classList.add('is-dragging');
      scroller.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    scroller.addEventListener('pointermove', function(event){
      if (event.pointerId !== pointerId) return;
      scroller.scrollLeft = startScrollLeft - (event.clientX - startX);
      event.preventDefault();
    });
    scroller.addEventListener('pointerup', finishDrag);
    scroller.addEventListener('pointercancel', finishDrag);
    scroller.addEventListener('lostpointercapture', finishDrag);
    scroller.addEventListener('dragstart', function(event){ event.preventDefault(); });
  }

  // ── Реальные счётчики в сайдбаре ──────────────────────────────────────────
  // Мои досье       -> GET /api/my/profile        (stats.total)
  // Общие досье     -> GET /api/public/dossiers    (total)
  // Транзакции      -> GET /api/my/transactions    (кол-во; >99 => "99+")
  // Базовый URL API — тот же, что использует остальной фронтенд (account-ui.js)
  function apiBase(){
    return window.ZSDashboard2.apiBase;
  }

  function authHeaders(){
    // Переиспользуем общий генератор заголовков, если он доступен
    if (typeof window.zsAuthHeaders === 'function') {
      try { return window.zsAuthHeaders(); } catch (e) {}
    }
    var h = {};
    try {
      var t = localStorage.getItem('lzt_token') || '';
      if (t) h['Authorization'] = 'Bearer ' + t;
    } catch (e) {}
    return h;
  }

  function fmtCount(n){
    n = Number(n) || 0;
    if (n < 0) n = 0;
    return n > 99 ? '99+' : String(n);
  }

  function setCount(sidebar, key, rawValue){
    var el = sidebar.querySelector('.sb-count[data-count="' + key + '"]');
    if (!el) return;
    var num = Number(rawValue) || 0;
    // Всегда показываем счётчик, даже когда значение 0.
    // inline-flex перебивает CSS display:none у вариантов 1–5.
    el.style.display = 'inline-flex';
    el.textContent = fmtCount(num);
  }

  function loadCounts(sidebar){
    if (!sidebar) return;

    // Cookie-сессия является основной; legacy-токен может отсутствовать.
    // Защищённые запросы сами вернут 401 для гостя.
    var base = apiBase();

    {
      fetch(base + '/api/my/profile', { headers: authHeaders(), credentials: 'include' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){
          if (!d) return;
          // Синхронно с обычной страницей «Мои досье»: исключаем error/expired.
          if (typeof d.visible_dossiers === 'number') {
            setCount(sidebar, 'my_dossiers', d.visible_dossiers);
          } else if (d.stats) {
            setCount(sidebar, 'my_dossiers', d.stats.done || 0);
          }
        })
        .catch(function(){});

      // Транзакции — предпочитаем total из ответа; если его нет (старый бэкенд)
      // считаем по длине массива. limit=100 покрывает счётчик "99+".
      fetch(base + '/api/my/transactions?limit=100', { headers: authHeaders(), credentials: 'include' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){
          if (!d) return;
          var count;
          if (typeof d.total !== 'undefined') {
            count = d.total;
          } else if (Array.isArray(d.transactions)) {
            count = d.transactions.length;
          } else {
            return;
          }
          setCount(sidebar, 'transactions', count);
        })
        .catch(function(){});
    }

    // Общие досье — публичные, доступны без авторизации
    fetch(base + '/api/public/dossiers?limit=1', { credentials: 'include' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if (d && typeof d.total !== 'undefined') setCount(sidebar, 'public_dossiers', d.total);
      })
      .catch(function(){});
  }
  
  function applyVariant(v){
    var el = document.getElementById('sidebarLab');
    if (!el) return;
    el.setAttribute('data-variant', String(v));
    localStorage.setItem('zelscan-sidebar-variant', String(v));
    variant = v;
    updateSwitcherUI(el);
    
    // Also update active state based on current page.
    zsSyncSidebarActive(el);
  }
  
  function zsSyncSidebarActive(el){
    if(!el) return;
    var legacyMap = {
      'zelscan_dashboard.html':'/app',
      'my_dossiers.html':'/dossiers',
      'public_dossiers.html':'/explore',
      'transactions.html':'/billing',
      'news.html':'/updates'
    };
    var path = location.pathname.replace(/\/+$/, '') || '/app';
    var last = path.split('/').pop().toLowerCase();
    var target = legacyMap[last] || path.toLowerCase();
    el.querySelectorAll('.sb-item').forEach(function(item){
      var href = (item.getAttribute('href') || '').replace(/\/+$/, '').toLowerCase();
      var hrefLast = href.split('/').pop();
      var normalizedHref = legacyMap[hrefLast] || href;
      item.classList.remove('is-active');
      item.removeAttribute('aria-current');
      if (normalizedHref === target) {
        item.classList.add('is-active');
        item.setAttribute('aria-current', 'page');
      }
    });
  }

  function initSwitcher(sidebar){
    var prev = sidebar.querySelector('.sb-switch-step.prev');
    var next = sidebar.querySelector('.sb-switch-step.next');
    var current = sidebar.querySelector('.sb-switch-current');
    var picker = sidebar.querySelector('.sb-variant-picker');
    var live = sidebar.querySelector('#sidebarVariantLive');
    
    if (prev) prev.onclick = function(){ applyVariant(variant <= 1 ? 12 : variant - 1); };
    if (next) next.onclick = function(){ applyVariant(variant >= 12 ? 1 : variant + 1); };
    
    if (current && picker){
      current.onclick = function(e){ e.stopPropagation(); picker.hidden = !picker.hidden; };
      current.setAttribute('aria-expanded', 'false');
    }
    
    // Variant picker options
    sidebar.querySelectorAll('.sb-variant-option').forEach(function(btn){
      btn.onclick = function(){
        var v = parseInt(btn.getAttribute('data-pick-variant'));
        if (!isNaN(v)){
          applyVariant(v);
          if (picker) picker.hidden = true;
          if (current) current.setAttribute('aria-expanded', 'false');
        }
      };
    });
    
    // Close picker on outside click
    document.addEventListener('click', function(e){
      if (picker && current && !sidebar.contains(e.target)){
        picker.hidden = true;
        current.setAttribute('aria-expanded', 'false');
      }
    });
    
    if (live) live.textContent = 'Sidebar variant ' + variant + ' applied.';
    
    updateSwitcherUI(sidebar);
  }
  
  function updateSwitcherUI(sidebar){
    var current = sidebar.querySelector('.sb-switch-current');
    var picker = sidebar.querySelector('.sb-variant-picker');
    var name = current ? current.querySelector('.sb-switch-name') : null;
    var number = current ? current.querySelector('.sb-switch-number') : null;
    if (name) name.textContent = variant;
    if (number) number.textContent = variant < 10 ? '0' + variant : '' + variant;
    // Update pressed state
    sidebar.querySelectorAll('.sb-variant-option').forEach(function(btn){
      var v = parseInt(btn.getAttribute('data-pick-variant'));
      btn.setAttribute('aria-pressed', v === variant ? 'true' : 'false');
    });
  }
  
  // Inject after DOM ready
  if (document.readyState === 'loading') {
    // Ждём DOMContentLoaded, НО стартуем как можно раньше, чтобы сайдбар не
    // появлялся с задержкой (FOUC). DOM при этом должен уже содержать .sidebar.
    var kickstart = function () {
      if (document.querySelector('.sidebar')) { init(); }
      else setTimeout(kickstart, 25);
    };
    document.addEventListener('DOMContentLoaded', kickstart);
    kickstart();
  } else {
    init();
  }
})();

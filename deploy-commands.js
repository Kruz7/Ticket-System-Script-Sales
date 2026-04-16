const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const config = require('./config.json');

const commands = [
  {
    name: 'ticketsetup',
    description: 'Ticket panelini kurar (yetkili rolü olanlar kullanabilir).'
  },
  {
    name: 'allticketclose',
    description: 'Aktif tüm ticketları kapatır (yetkili).'
  },
  {
    name: 'ticketisim',
    description: 'O anki ticket kanalının ismini değiştirir (sadece ticket içinde, yetkili).',
    options: [
      {
        name: 'isim',
        type: 3, // STRING
        description: 'Yeni ticket kanal ismi',
        required: true
      }
    ]
  },
  {
    name: 'ticketreset',
    description: 'Tüm ticket sayılarını sıfırlar (sadece yetkili).'
  }
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    console.log('Slash komutları deploy ediliyor...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Deploy tamamlandı.');
  } catch (err) {
    console.error(err);
  }
})();

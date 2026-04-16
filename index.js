const fs = require('fs-extra');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder
} = require('discord.js');
const config = require('./config.json');

const DATA_FILE = path.join(__dirname, 'data', 'activeTickets.json');
fs.ensureFileSync(DATA_FILE);

let activeTickets = {};
try {
  activeTickets = fs.readJsonSync(DATA_FILE);
} catch {
  activeTickets = {};
}

function saveTickets() {
  fs.writeJsonSync(DATA_FILE, activeTickets, { spaces: 2 });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`✅ Bot is active: ${client.user.tag}`);
});

function createTicketName(type, guild) {
  const map = {
    purchase: 'purchase-assistance',
    payment: 'payment-support',
    technical: 'technical-support',
    general: 'general-inquiries'
  };

  const baseName = map[type] || 'ticket';

  let count = 1;
  for (const chId of Object.values(activeTickets)) {
    const ch = guild.channels.cache.get(chId);
    if (ch && ch.name.startsWith(baseName)) {
      const match = ch.name.match(/-(\d+)$/);
      if (match) {
        const num = parseInt(match[1]);
        if (num >= count) count = num + 1;
      } else {
        count = 2;
      }
    }
  }

  return `${baseName}-${count}`;
}

async function resetTicketCounters(guild) {
  const types = ['purchase', 'payment', 'technical', 'general'];
  const map = {
    purchase: 'purchase-assistance',
    payment: 'payment-support',
    technical: 'technical-support',
    general: 'general-inquiries'
  };

  for (const type of types) {
    let count = 1;
    for (const [userId, channelId] of Object.entries(activeTickets)) {
      try {
        const ch = await guild.channels.fetch(channelId);
        if (!ch) continue;

        if (ch.name.startsWith(map[type])) {
          const newName = `${map[type]}-${count}`;
          await ch.setName(newName).catch(() => {});
          count++;
        }
      } catch {
      }
    }
  }

  if (config.ticketLogChannelId) {
    const logCh = await guild.channels.fetch(config.ticketLogChannelId).catch(() => null);
    if (logCh) {
      const embed = new EmbedBuilder()
        .setTitle('🔄 Ticket Counters Reset')
        .setColor(0xFFA500)
        .setTimestamp();
      await logCh.send({ embeds: [embed] });
    }
  }
}

async function createTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let transcript = `Ticket Transcript - Channel: ${channel.name}\n\n`;
  for (const msg of sorted.values()) {
    const time = new Date(msg.createdTimestamp).toLocaleString('en-US');
    transcript += `[${time}] ${msg.author.tag}: ${msg.content || ''}\n`;
  }

  return Buffer.from(transcript, 'utf-8');
}

async function logTicketOpen(guild, user, ticketType, ticketChannel) {
  if (!config.ticketLogChannelId) return;
  try {
    const logCh = await guild.channels.fetch(config.ticketLogChannelId);
    const embed = new EmbedBuilder()
      .setTitle('🎫 New Ticket Opened')
      .setDescription(`<@${user.id}> created <#${ticketChannel.id}> channel.\nTicket Type: **${ticketType}**`)
      .setColor(0x00FF00)
      .setTimestamp();
    await logCh.send({ embeds: [embed] });
  } catch {}
}

async function logTicketClose(channel, ticketOwner, closerUser) {
  if (!config.ticketLogChannelId) return;
  try {
    const guild = channel.guild;
    const logCh = await guild.channels.fetch(config.ticketLogChannelId);

    const embed = new EmbedBuilder()
      .setTitle('❌ Ticket Closed')
      .setDescription(`<@${closerUser.id}> closed <#${channel.id}> channel.\nTicket Owner: <@${ticketOwner.id}>`)
      .setColor(0xFF0000)
      .setTimestamp();

    await logCh.send({ embeds: [embed] });

    const transcriptBuffer = await createTranscript(channel);
    const attachment = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${channel.name}.txt` });

    await logCh.send({ files: [attachment] });
  } catch {}
}

client.on('interactionCreate', async (interaction) => {
  const isStaff = () => config.staffRoleId && interaction.member.roles.cache.has(config.staffRoleId);

  if (interaction.isCommand()) {
    const { commandName } = interaction;

    if (commandName === 'ticketsetup') {
      if (!isStaff()) return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle('🎫 Nevers | Support System')
        .setDescription(
          `📂 **Support Categories:**\n\n` +
          `🛒 Purchase Assistance\n` +
          `💳 Payment Support\n` +
          `🛠️ Technical Support\n` +
          `📩 General Inquiries\n\n` +
          `Please select the appropriate support category from the menu below to create a new support ticket.\n\n` +
          `🔔 All submitted tickets are reviewed and answered by the Nevers Support Team as quickly as possible.`
        )
        .setColor(0x2F3136)
        .setImage('https://cdn.discordapp.com/attachments/1278724931139665971/1453079792407679131/Nevers-Logo.png')
        .setFooter({ text: 'Nevers - Ticket System' });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_category_select')
        .setPlaceholder('Click to select a category')
        .addOptions([
          { label: '🛒 Purchase Assistance', value: 'purchase' },
          { label: '💳 Payment Support', value: 'payment' },
          { label: '🛠️ Technical Support', value: 'technical' },
          { label: '📩 General Inquiries', value: 'general' },
          { label: '⭕ Cancel Selection', value: 'clear' }
        ]);

      await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    else if (commandName === 'allticketclose') {
      if (!isStaff()) return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });

      await interaction.reply({ content: '🔄 Closing all tickets...', ephemeral: true });

      for (const [userId, channelId] of Object.entries(activeTickets)) {
        try {
          const ch = await client.channels.fetch(channelId);
          if (ch) await ch.delete('Closed by staff');
        } catch {}
        delete activeTickets[userId];
      }

      saveTickets();
      await interaction.followUp({ content: '✅ All tickets were closed.', ephemeral: true });
      return;
    }

    else if (commandName === 'ticketreset') {
      if (!isStaff()) return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });

      await resetTicketCounters(interaction.guild);
      await interaction.reply({ content: '✅ All ticket counters have been reset.', ephemeral: true });
      return;
    }

    else if (commandName === 'ticketname') {
      const newName = interaction.options.getString('name');
      const chan = interaction.channel;

      if (!chan) return interaction.reply({ content: '🚫 Channel not found.', ephemeral: true });
      if (!Object.values(activeTickets).includes(chan.id)) return interaction.reply({ content: '🚫 This channel is not a ticket.', ephemeral: true });
      if (!isStaff()) return interaction.reply({ content: '🚫 You are not authorized.', ephemeral: true });

      await chan.setName(newName).catch(() => {});
      return interaction.reply({ content: `✅ Ticket name changed to **${newName}**.`, ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
    const value = interaction.values[0];
    if (value === 'clear') {
      await interaction.reply({ content: '✅ Selection cleared.', ephemeral: true });
      return;
    }

    const type = value;
    const userId = interaction.user.id;

    if (activeTickets[userId]) {
      await interaction.reply({ content: '🚫 You already have an open ticket.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const channelName = createTicketName(type, interaction.guild);

    const permissionOverwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];

    if (config.staffRoleId) {
      const staffRole = interaction.guild.roles.cache.get(config.staffRoleId);
      if (staffRole) {
        permissionOverwrites.push({
          id: staffRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }
    }

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites,
      parent: config.ticketCategoryId || null
    });

    activeTickets[userId] = channel.id;
    saveTickets();

    await logTicketOpen(interaction.guild, interaction.user, type, channel);

    const typeLabels = {
      purchase: 'Purchase Assistance',
      payment: 'Payment Support',
      technical: 'Technical Support',
      general: 'General Inquiries'
    };

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`🎫 ${typeLabels[type] || 'Ticket'}`)
      .setDescription(`Hello! Our support team will assist you as soon as possible.\n\nPlease provide detailed information about your issue so we can help you better.`)
      .setColor(0xED4245)
      .setImage('https://cdn.discordapp.com/attachments/1278724931139665971/1453079792407679131/Nevers-Logo.png')
      .setFooter({ text: 'Nevers Support Team' })
      .setTimestamp();

    const embedMessage = await channel.send({
      content: config.staffRoleId ? `<@&${config.staffRoleId}>` : '',
      embeds: [ticketEmbed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`payment_${userId}`).setLabel('Payment Information').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`close_${userId}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
      )]
    });

    const userMentionMessage = await channel.send({
      content: `<@${userId}>`
    });

    setTimeout(async () => {
      try {
        await userMentionMessage.delete();
      } catch (error) {
        console.error('Error deleting user mention message:', error);
      }
    }, 3000);

    await interaction.followUp({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
    return;
  }

  if (interaction.isButton()) {
    const [action, ownerId] = interaction.customId.split('_');
    if (!interaction.member.roles.cache.has(config.staffRoleId)) {
      await interaction.reply({ content: '🚫 You do not have permission to use this button.', ephemeral: true });
      return;
    }

    if (action === 'payment') {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('💳 Payment Information')
            .setDescription(`IBAN: \`${config.iban}\``)
            .setColor(0x2F3136)
        ],
        ephemeral: false
      });
      return;
    }

    if (action === 'close') {
      const mappingEntry = Object.entries(activeTickets).find(([uid, cid]) => cid === interaction.channel.id);
      if (mappingEntry) {
        const [userId, channelId] = mappingEntry;
        let userMember = null;
        try {
          userMember = await interaction.guild.members.fetch(userId);
        } catch {
        }

        delete activeTickets[userId];
        saveTickets();

        await interaction.reply({ content: '⏳ Ticket is closing...', ephemeral: true });

        if (userMember) {
          await logTicketClose(interaction.channel, userMember.user, interaction.user);
        }

        setTimeout(() => interaction.channel.delete().catch(() => {}), 1500);
      }
      return;
    }
  }
});

client.login(config.token);
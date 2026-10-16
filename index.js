
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const fs = require('node:fs');
const path = require('node:path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const birthdaysFile = path.join(__dirname, 'birthdays.json');
let birthdays = {};

function loadBirthdays() {
  try {
    if (fs.existsSync(birthdaysFile)) {
      birthdays = JSON.parse(
        fs.readFileSync(birthdaysFile, 'utf8')
      );
    }
  } catch (error) {
    console.error('Could not load birthdays:', error);
    birthdays = {};
  }
}

function saveBirthdays() {
  fs.writeFileSync(
    birthdaysFile,
    JSON.stringify(birthdays, null, 2)
  );
}

function getNextBirthday(day, month, year) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let next = new Date(
    today.getFullYear(),
    month - 1,
    day
  );

  if (next < today) {
    next = new Date(
      today.getFullYear() + 1,
      month - 1,
      day
    );
  }

  const daysLeft = Math.round(
    (next - today) / (1000 * 60 * 60 * 24)
  );

  const age = next.getFullYear() - year;

  return { next, daysLeft, age };
}

function validBirthday(day, month, year) {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > new Date().getFullYear() ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

const commands = [
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Set a member’s birthday')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('day')
        .setDescription('Birthday day (1-31)')
        .setMinValue(1)
        .setMaxValue(31)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('month')
        .setDescription('Birthday month (1-12)')
        .setMinValue(1)
        .setMaxValue(12)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('year')
        .setDescription('Birth year')
        .setMinValue(1900)
        .setMaxValue(new Date().getFullYear())
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a member’s birthday')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Show upcoming birthdays and ages')
];

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: commands.map(command => command.toJSON())
      }
    );

    console.log('Slash commands registered!');
  } catch (error) {
    console.error('Could not register slash commands:', error);
  }

  async function checkBirthdays() {
    const now = new Date();
    const currentYear = now.getFullYear();

    for (const [userId, birthday] of Object.entries(birthdays)) {
      if (
        birthday.month === now.getMonth() + 1 &&
        birthday.day === now.getDate() &&
        birthday.lastSent !== currentYear
      ) {
        const age = currentYear - birthday.year;

        const channel = await client.channels
          .fetch(process.env.BIRTHDAY_CHANNEL_ID)
          .catch(() => null);

        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🎂 Today’s Birthdays!')
            .setDescription(
              `Today is the birthday of <@${userId}>! 🎉\n\n` +
              `They are turning **${age} years old** today! 🥳`
            )
            .setTimestamp();

          await channel.send({ embeds: [embed] })
            .catch(console.error);

          birthday.lastSent = currentYear;
          saveBirthdays();
        }
      }
    }
  }

  await checkBirthdays();
  setInterval(checkBirthdays, 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'set') {
    const user = interaction.options.getUser('user');
    const day = interaction.options.getInteger('day');
    const month = interaction.options.getInteger('month');
    const year = interaction.options.getInteger('year');

    if (!validBirthday(day, month, year)) {
      return interaction.reply({
        content: '❌ Please enter a valid birthday.',
        ephemeral: true
      });
    }

    birthdays[user.id] = {
      day,
      month,
      year,
      lastSent: null
    };

    saveBirthdays();

    const monthName = new Date(2000, month - 1)
      .toLocaleString('en-US', { month: 'long' });

    return interaction.reply(
      `🎂 Saved **${user.username}**'s birthday: ` +
      `${day} ${monthName} ${year}.`
    );
  }

  if (interaction.commandName === 'remove') {
    const user = interaction.options.getUser('user');

    if (!birthdays[user.id]) {
      return interaction.reply({
        content: `❌ No birthday is saved for ${user.username}.`,
        ephemeral: true
      });
    }

    delete birthdays[user.id];
    saveBirthdays();

    return interaction.reply(
      `✅ Removed **${user.username}**'s birthday.`
    );
  }

  if (interaction.commandName === 'next') {
    await interaction.deferReply();

    const entries = Object.entries(birthdays);

    if (entries.length === 0) {
      return interaction.editReply(
        'No birthdays have been added yet!'
      );
    }

    const upcoming = entries
      .map(([userId, birthday]) => ({
        userId,
        ...birthday,
        ...getNextBirthday(
          birthday.day,
          birthday.month,
          birthday.year
        )
      }))
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const description = upcoming
      .slice(0, 20)
      .map((birthday, index) => {
        const dateText = birthday.next.toLocaleDateString(
          'en-GB',
          { day: 'numeric', month: 'long' }
        );

        let daysText;

        if (birthday.daysLeft === 0) {
          daysText = 'today!';
        } else if (birthday.daysLeft === 1) {
          daysText = 'in 1 day';
        } else {
          daysText = `in ${birthday.daysLeft} days`;
        }

        return (
          `**${index + 1}.** 🎂 <@${birthday.userId}> — ` +
          `${dateText} (${daysText}) · ` +
          `Turning **${birthday.age}** 🎉`
        );
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('🎂 Upcoming Birthdays')
      .setDescription(description);

    return interaction.editReply({ embeds: [embed] });
  }
});

loadBirthdays();

if (
  !process.env.DISCORD_TOKEN ||
  !process.env.CLIENT_ID ||
  !process.env.GUILD_ID ||
  !process.env.BIRTHDAY_CHANNEL_ID
) {
  console.error('Missing configuration in .env file!');
} else {
  client.login(process.env.DISCORD_TOKEN);
}

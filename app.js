const Discord = require("discord.js");
const client = new Discord.Client();

// Load configs
var cr = require("./config.json");
client.package = require("./package.json");
client.defaultPrefix = cr.prefix;
client.botOwnerID = cr.ownerID;

// Configure mongoose, load models used in this script
const mongoose = require("mongoose");
mongoose.Promise = global.Promise;
const Guild = require("./models/Guild");
mongoose.connect(cr.db_endpoint);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error"));

// Log into Discord *after* db connection established
db.once("open", function() {
	client.db = db;
	client.login(cr.token);
	console.log("Connected to db.");
});

// Load commands.
const SurveyLauncher = require("./helpers/SurveyLauncher");
let surveyLauncher;

// TODO: Recursively search commands directory
client.commands = new Map();
client.once("ready", () => {
	const dir = "./commands/";
	const fs = require("fs");

	fs.readdir(dir, (err, files) => {
		if(err){
			console.log(dir);
			console.log(err);
			process.exit(0);
		}
		else{
			for(let i = 0; i < files.length; i++){
				let fileName = files[i];
				let mod = require(`./commands/${/(.*)\.js/.exec(fileName)[1]}`);
				let cmd = new mod(client);
				console.log(`Loaded command ${cmd.name}`);
				client.commands.set(cmd.name, cmd);
			}
		}
	});

	// Hardcoded target guild
	client.mainGuild = client.guilds.get("319470417150738432");
	surveyLauncher = new SurveyLauncher(client);

	console.log(`Ready to begin! Serving in ${client.guilds.size} servers.`);
	client.user.setGame(`DM "help" for assistance! | Version ${client.package.version}`);
});

client.on("disconnect", () => {
	console.log("Disconnected.");
	process.exit(0);
});

client.on("error", (error) => {
	console.log("Error event:");
	console.log(error);
});

client.on("guildCreate", async (guild) =>{
	await new Guild({id: guild.id, prefix: client.defaultPrefix, greeting: "", elevatedRoles: []}).save();

	let toSend = [
		`Hi! Thank you for inviting me to ${guild.name}. Here are a few tips to get started.\n`,
		"My default prefix is `!`. What this means is every command starts with the `!` character; for example, !help or !spell.",
		"If you'd like to change my prefix for your server, use the `prefix` command. For example:",
		"!prefix $",
		"would change the prefix to `$`, so future commands should be executed like so: $help, $spell, $creature, etc.\n",
		"Also, in case anything goes awry, you can always execute my commands by mentioning me instead of using a prefix. Examples:",
		`${client.user} help`,
		`${client.user} prefix !`,
		"If you'd like to execute commands here in a DM with me, please don't use a prefix at all.",
		"If you require more support, please feel free to ask about anything on my help server.",
		"https://discord.gg/KWsvFGG"
	];
	guild.owner.sendMessage(toSend);
});

client.on("guildMemberAdd", async (member) => {
	// Fetch the guild's greeting
	let guild = await Guild.findOne({id: member.guild.id});
	if(guild.greeting.length > 0){
		await member.sendMessage(guild.greeting);
	}

	// Assign the PROCESSING role
	let processingRole = member.guild.roles.find("name", "Processing");
	member.addRole(processingRole);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
	let processingRole = oldMember.guild.roles.find("name", "Processing");

	// If "Processing" is a NEW role, then initiate the survey sequence
	if(newMember.roles.get(processingRole.id) && !oldMember.roles.get(processingRole.id)){
		surveyLauncher.launch(newMember);
	}

});

client.on("message", async (msg) => {
	if(msg.author.bot){	// Don't respond to bots
		return;
	}

	let prefix;	// Determine prefix
	if(msg.guild){
		prefix = await client.fetchPrefix(msg.guild.id);
	}
	else{
		prefix = "";
	}

	let offset;	// Number of characters to ignore (prefix length)
	if(msg.content.startsWith(prefix)){
		offset = prefix.length;
	}
	else if(msg.content.startsWith(client.user.toString())){
		offset = client.user.toString().length + 1;
	}
	else{
		return;
	}

	let commandString = msg.content.substring(offset).split(" ")[0].toLowerCase();
	let command = client.commands.get(commandString);

	// TODO: In the absence of a command, execute any triggers if applicable.
	if(!command){
		return;
	}

	try{
		let args = msg.content.substring(offset + commandString.length).trim();
		if(args){
			args = args.split(" ");
		}
		if(command){
			let hasPerm = await command.checkPermission(msg.member || msg.author);
			if(!hasPerm){
				return msg.reply("you don't have permission to execute that command, or this command can only be executed in a Guild channel.");
			}
			command.execute(msg, args);
		}
	}
	catch(err){
		console.log("Error onMessage:");
		console.log(err);
	}
});

client.fetchPrefix = async function(id){
	if(client.db){
		let guild = await Guild.findOne({id: id});
		return guild.prefix || client.defaultPrefix;
	}
};

client.fetchElevatedRoleIDs = async function(id){
	if(client.db){
		let guild = await Guild.findOne({id: id});
		if(guild){
			return guild.elevatedRoles;
		}
		else{
			return [];
		}
	}
};

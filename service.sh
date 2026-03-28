#!/system/bin/sh
# Headwolf_F8_KPM_OC_APatch service script
MODDIR=${0%/*}

# Load the compiled KPM module into the kernel during late boot
insmod $MODDIR/kpm_oc.ko

# Ensure sysfs parameters are accessible if needed
chmod 644 /sys/module/kpm_oc/parameters/*
